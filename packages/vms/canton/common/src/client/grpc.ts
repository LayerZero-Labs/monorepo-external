import {
    AddTransactionsRequest,
    AuthorizeRequest,
    Enums_TopologyChangeOp,
    GenerateTransactionsRequest,
    GenerateTransactionsRequest_Proposal,
    ListDecentralizedNamespaceDefinitionRequest,
    ListNamespaceDelegationRequest,
    ListPartyToKeyMappingRequest,
    ListPartyToParticipantRequest,
    type SignedTopologyTransaction,
    TopologyManagerReadServiceClient,
    TopologyManagerWriteServiceClient,
    type TopologyMapping,
} from '@canton-network/core-ledger-proto';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';

import type { TokenProvider } from '../auth/token-provider';
import { CantonError, CantonProtocolError } from '../errors';
import {
    buildDecentralizedNamespaceDefinitionMapping,
    buildNamespaceDelegationMapping,
    buildPartyToKeyMapping,
    buildPartyToParticipantMapping,
} from './topology/mappings';
import { SynchronizerConnectivityServiceClient } from './topology/synchronizer-connectivity';
import type {
    CantonGrpcClientOptions,
    CreateDecentralizedNamespaceDefinitionTxParams,
    CreateNamespaceDelegationTxParams,
    CreatePartyToKeyMappingTxParams,
    CreatePartyToParticipantMappingTxParams,
    DecentralizedNamespaceDefinitionState,
    GeneratedTopologyTransaction,
    NamespaceDelegationState,
    PartyToKeyMappingState,
    PartyToParticipantMappingState,
    UpdateDecentralizedNamespaceDefinitionTxParams,
} from './topology/types';
import {
    buildChannelCredentials,
    computeDecentralizedNamespace,
    headStateBaseQuery,
    synchronizerStore,
} from './topology/utils';
import { computePublicKeyFingerprint } from './utils';

// Canton error id for a topology transaction the store has not seen yet. gRPC errors carry it only
// in the message, so it is matched there.
const TOPOLOGY_TRANSACTION_NOT_FOUND = 'TOPOLOGY_TRANSACTION_NOT_FOUND';

/** Default gRPC client options: 128 MiB message-size limits for large admin responses. */
const DEFAULT_GRPC_CLIENT_OPTIONS = {
    'grpc.max_receive_message_length': 128 * 1024 * 1024,
    'grpc.max_send_message_length': 128 * 1024 * 1024,
} as const;

/**
 * gRPC client for the Canton participant admin Topology Manager API.
 *
 * Exposes read queries for topology mappings and write helpers that call
 * `GenerateTransactions` to produce unsigned topology transactions and
 * `AddTransactions` to submit signed ones.
 *
 * A fresh Bearer token is attached to each RPC via {@link TokenProvider}.
 */
export class CantonGrpcClient {
    readonly #transport: GrpcTransport;
    readonly #topologyRead: TopologyManagerReadServiceClient;
    readonly #topologyWrite: TopologyManagerWriteServiceClient;
    readonly #connectivity: SynchronizerConnectivityServiceClient;
    readonly #tokenProvider: TokenProvider;
    #synchronizerId?: string;

    /**
     * @param opts - Admin API host, auth, optional synchronizer id, and transport security.
     */
    constructor(opts: CantonGrpcClientOptions) {
        this.#tokenProvider = opts.tokenProvider;
        this.#synchronizerId = opts.synchronizerId;
        this.#transport = new GrpcTransport({
            host: opts.host,
            channelCredentials: buildChannelCredentials(opts.host, opts.insecureTransport),
            clientOptions: opts.grpcClientOptions ?? DEFAULT_GRPC_CLIENT_OPTIONS,
        });
        this.#topologyRead = new TopologyManagerReadServiceClient(this.#transport);
        this.#topologyWrite = new TopologyManagerWriteServiceClient(this.#transport);
        this.#connectivity = new SynchronizerConnectivityServiceClient(this.#transport);
    }

    /** Returns per-RPC gRPC metadata with a fresh Bearer token. */
    async #getMeta(): Promise<Record<string, string>> {
        const token = await this.#tokenProvider.getToken();
        return { Authorization: `Bearer ${token}` };
    }

    /**
     * Returns the client synchronizer id, discovering it on first use when omitted at construction.
     *
     * @throws {CantonProtocolError} If the participant exposes no synchronizer store.
     */
    async #getSynchronizerId(): Promise<string> {
        if (this.#synchronizerId) {
            return this.#synchronizerId;
        }
        this.#synchronizerId = await this.#discoverSynchronizerId();
        return this.#synchronizerId;
    }

    /**
     * Resolves the logical id of the first synchronizer the participant is connected to.
     *
     * @throws {CantonProtocolError} If the participant is not connected to any synchronizer.
     */
    async #discoverSynchronizerId(): Promise<string> {
        const { response } = await this.#connectivity.listConnectedSynchronizers(
            {},
            { meta: await this.#getMeta() },
        );
        for (const synchronizer of response.connectedSynchronizers) {
            if (synchronizer.synchronizerId) {
                return synchronizer.synchronizerId;
            }
        }
        throw new CantonProtocolError('Participant is not connected to any synchronizer');
    }

    /**
     * Calls `GenerateTransactions` for a single ADD_REPLACE mapping.
     *
     * @param synchronizerId - Synchronizer store to target.
     * @param mapping - Topology mapping to encode into the transaction.
     * @param serial - Topology serial (`0` lets Canton auto-determine).
     * @returns Unsigned topology transaction (`serializedTransaction`, `transactionHash`).
     * @throws {CantonProtocolError} If the RPC returns no generated transaction.
     */
    async #generateTopologyTransaction(
        synchronizerId: string,
        mapping: TopologyMapping,
        serial: number,
    ): Promise<GeneratedTopologyTransaction> {
        const { response } = await this.#topologyWrite.generateTransactions(
            GenerateTransactionsRequest.create({
                proposals: [
                    GenerateTransactionsRequest_Proposal.create({
                        operation: Enums_TopologyChangeOp.ADD_REPLACE,
                        serial,
                        mapping,
                        store: synchronizerStore(synchronizerId),
                    }),
                ],
            }),
            { meta: await this.#getMeta() },
        );

        const generated = response.generatedTransactions[0];

        if (!generated) {
            throw new CantonProtocolError('GenerateTransactions returned no topology transaction');
        }

        return generated;
    }

    /**
     * Lists Namespace Delegation (NSD) mappings for a namespace.
     *
     * Queries topology head state on the synchronizer. Returns every result from
     * the list RPC.
     *
     * @param namespaceFingerprint - Namespace to filter on (for root NSD, the owner key fingerprint).
     * @returns All matching NSD mappings, or an empty array if none exist.
     */
    async getNamespaceDelegation(
        namespaceFingerprint: string,
    ): Promise<NamespaceDelegationState[]> {
        const synchronizerId = await this.#getSynchronizerId();
        const { response } = await this.#topologyRead.listNamespaceDelegation(
            ListNamespaceDelegationRequest.create({
                baseQuery: headStateBaseQuery(synchronizerId),
                filterNamespace: namespaceFingerprint,
                // Empty string = no target-key filter; return all delegations for this namespace.
                filterTargetKeyFingerprint: '',
            }),
            { meta: await this.#getMeta() },
        );

        return response.results.flatMap((result) => {
            const item = result.item;
            const publicKey = item?.targetKey?.publicKey;
            if (!item || !publicKey) {
                return [];
            }
            return [
                {
                    namespace: item.namespace,
                    targetKeyFingerprint: computePublicKeyFingerprint(publicKey),
                    targetPublicKeyDer: publicKey,
                    // `is_root_delegation` is deprecated: current nodes report the scope in
                    // `restriction` and leave the bool false, so accept either.
                    isRootDelegation:
                        item.isRootDelegation ||
                        item.restriction.oneofKind === 'canSignAllMappings',
                    serial: result.context?.serial ?? 0,
                },
            ];
        });
    }

    /**
     * Lists Decentralized Namespace Definition (DND) mappings for a namespace.
     *
     * Queries topology head state on the synchronizer. For a party id `hint::1220…`,
     * pass the `1220…` suffix as `namespaceFingerprint`.
     *
     * @param namespaceFingerprint - Decentralized namespace fingerprint to filter on.
     * @param proposals - If `true`, query pending proposals instead of authorized mappings.
     * @returns All matching DND mappings, or an empty array if none exist.
     */
    async getDecentralizedNamespaceDefinition(
        namespaceFingerprint: string,
        proposals = false,
    ): Promise<DecentralizedNamespaceDefinitionState[]> {
        const synchronizerId = await this.#getSynchronizerId();
        const { response } = await this.#topologyRead.listDecentralizedNamespaceDefinition(
            ListDecentralizedNamespaceDefinitionRequest.create({
                baseQuery: headStateBaseQuery(synchronizerId, proposals),
                filterNamespace: namespaceFingerprint,
            }),
            { meta: await this.#getMeta() },
        );

        return response.results.flatMap((result) => {
            const item = result.item;
            if (!item) {
                return [];
            }
            return [
                {
                    namespace: item.decentralizedNamespace,
                    threshold: item.threshold,
                    owners: [...item.owners],
                    serial: result.context?.serial ?? 0,
                    transactionHash: result.context?.transactionHash?.length
                        ? Buffer.from(result.context.transactionHash).toString('hex')
                        : undefined,
                    signedByFingerprints: result.context
                        ? [...result.context.signedByFingerprints]
                        : undefined,
                },
            ];
        });
    }

    /**
     * Lists Party-to-Key (PTK) mappings for a party.
     *
     * Queries topology head state on the synchronizer.
     *
     * @param partyId - Full party identifier (e.g. `hint::1220…`).
     * @param proposals - List pending proposals instead of the effective state.
     * @returns All matching PTK mappings, or an empty array if none exist.
     */
    async getPartyToKeyMapping(
        partyId: string,
        proposals = false,
    ): Promise<PartyToKeyMappingState[]> {
        const synchronizerId = await this.#getSynchronizerId();
        const { response } = await this.#topologyRead.listPartyToKeyMapping(
            ListPartyToKeyMappingRequest.create({
                baseQuery: headStateBaseQuery(synchronizerId, proposals),
                filterParty: partyId,
            }),
            { meta: await this.#getMeta() },
        );

        return response.results.flatMap((result) => {
            const item = result.item;
            if (!item) {
                return [];
            }
            return [
                {
                    party: item.party,
                    threshold: item.threshold,
                    signingKeyFingerprints: item.signingKeys.map((key) =>
                        computePublicKeyFingerprint(key.publicKey),
                    ),
                    serial: result.context?.serial ?? 0,
                    transactionHash: result.context?.transactionHash?.length
                        ? Buffer.from(result.context.transactionHash).toString('hex')
                        : undefined,
                    signedByFingerprints: result.context
                        ? [...result.context.signedByFingerprints]
                        : undefined,
                },
            ];
        });
    }

    /**
     * Lists Party-to-Participant (PTP) mappings for a party.
     *
     * Queries topology head state on the synchronizer.
     *
     * @param partyId - Full party identifier (e.g. `hint::1220…`).
     * @param proposals - If `true`, query pending proposals instead of authorized mappings.
     * @returns All matching PTP mappings, or an empty array if none exist.
     */
    async getPartyToParticipantMapping(
        partyId: string,
        proposals = false,
    ): Promise<PartyToParticipantMappingState[]> {
        const synchronizerId = await this.#getSynchronizerId();
        const { response } = await this.#topologyRead.listPartyToParticipant(
            ListPartyToParticipantRequest.create({
                baseQuery: headStateBaseQuery(synchronizerId, proposals),
                filterParty: partyId,
                // Empty string = no participant filter; return all hosting mappings for this party.
                filterParticipant: '',
            }),
            { meta: await this.#getMeta() },
        );

        return response.results.flatMap((result) => {
            const item = result.item;
            if (!item) {
                return [];
            }
            return [
                {
                    party: item.party,
                    threshold: item.threshold,
                    participants: item.participants.map((participant) => ({
                        participantUid: participant.participantUid,
                        permission: participant.permission,
                    })),
                    serial: result.context?.serial ?? 0,
                },
            ];
        });
    }

    /**
     * Builds an unsigned Namespace Delegation (NSD) topology transaction.
     *
     * Calls `GenerateTransactions` with an ADD_REPLACE mapping. The returned
     * `transactionHash` must be signed by the namespace key.
     *
     * @param params - Owner public key and optional serial.
     * @returns Unsigned topology transaction (`serializedTransaction`, `transactionHash`).
     */
    async createNamespaceDelegationTx(
        params: CreateNamespaceDelegationTxParams,
    ): Promise<GeneratedTopologyTransaction> {
        const synchronizerId = await this.#getSynchronizerId();
        const mapping = buildNamespaceDelegationMapping(params.publicKeyDer);
        return this.#generateTopologyTransaction(synchronizerId, mapping, params.serial ?? 0);
    }

    /**
     * Builds an unsigned Decentralized Namespace Definition (DND) topology transaction.
     *
     * The decentralized namespace id is derived from `params.owners`. All owners
     * must sign the transaction hash.
     *
     * @param params - Owner fingerprints, threshold, and optional serial.
     * @returns Unsigned topology transaction (`serializedTransaction`, `transactionHash`).
     */
    async createDecentralizedNamespaceDefinitionTx(
        params: CreateDecentralizedNamespaceDefinitionTxParams,
    ): Promise<GeneratedTopologyTransaction> {
        const synchronizerId = await this.#getSynchronizerId();
        const decentralizedNamespace = computeDecentralizedNamespace(params.owners);
        const mapping = buildDecentralizedNamespaceDefinitionMapping(
            decentralizedNamespace,
            params.threshold,
            params.owners,
        );
        return this.#generateTopologyTransaction(synchronizerId, mapping, params.serial ?? 0);
    }

    async updateDecentralizedNamespaceDefinitionTx(
        params: UpdateDecentralizedNamespaceDefinitionTxParams,
    ): Promise<GeneratedTopologyTransaction> {
        const synchronizerId = await this.#getSynchronizerId();
        const mapping = buildDecentralizedNamespaceDefinitionMapping(
            params.namespace,
            params.threshold,
            params.owners,
        );
        return this.#generateTopologyTransaction(synchronizerId, mapping, params.serial ?? 0);
    }

    /**
     * Builds an unsigned Party-to-Key (PTK) topology transaction.
     *
     * Decentralized namespace owners must sign the transaction hash.
     *
     * @param params - Party id, signing keys, threshold, and optional serial.
     * @returns Unsigned topology transaction (`serializedTransaction`, `transactionHash`).
     */
    async createPartyToKeyTx(
        params: CreatePartyToKeyMappingTxParams,
    ): Promise<GeneratedTopologyTransaction> {
        const synchronizerId = await this.#getSynchronizerId();
        const mapping = buildPartyToKeyMapping(
            params.partyId,
            params.signingPublicKeyDers,
            params.threshold,
        );
        return this.#generateTopologyTransaction(synchronizerId, mapping, params.serial ?? 0);
    }

    /**
     * Builds an unsigned Party-to-Participant (PTP) topology transaction.
     *
     * Party owners sign the transaction hash. On submit, set `proposal: true` on the
     * signed transaction so the hosting participant can authorize via `Authorize`.
     *
     * @param params - Party id, participant ids, threshold, and optional serial.
     * @returns Unsigned topology transaction (`serializedTransaction`, `transactionHash`).
     */
    async createPartyToParticipantTx(
        params: CreatePartyToParticipantMappingTxParams,
    ): Promise<GeneratedTopologyTransaction> {
        const synchronizerId = await this.#getSynchronizerId();
        const mapping = buildPartyToParticipantMapping(
            params.partyId,
            params.participantIds,
            params.threshold,
        );
        return this.#generateTopologyTransaction(synchronizerId, mapping, params.serial ?? 0);
    }

    /**
     * Submits signed topology transactions to the synchronizer store.
     *
     * Multiple transactions are submitted atomically in one `AddTransactions` call.
     * When batching, sign `computeMultiTransactionHash` over all transaction hashes
     * and attach the same `MultiTransactionSignatures` to each entry.
     *
     * Set `proposal: true` on a transaction when the hosting participant must
     * authorize that mapping afterward.
     *
     * @param transactions - One or more signed topology transactions.
     * @throws {CantonError} If `transactions` is empty.
     */
    async submitTopologyTransactions(
        transactions: readonly SignedTopologyTransaction[],
    ): Promise<void> {
        if (transactions.length === 0) {
            throw new CantonError('AddTransactions requires at least one transaction');
        }
        const synchronizerId = await this.#getSynchronizerId();
        await this.#topologyWrite.addTransactions(
            AddTransactionsRequest.create({
                transactions: [...transactions],
                store: synchronizerStore(synchronizerId),
            }),
            { meta: await this.#getMeta() },
        );
    }

    /**
     * Authorizes a pending topology proposal by its hash.
     *
     * The participant uses its own local signing keys to add its authorization to
     * the pending proposal identified by `transactionHashHex`. For a PTP where the
     * participant is a required signer, this completes the authorization so the
     * transaction becomes effective on the synchronizer.
     *
     * @param transactionHashHex - Hex-encoded hash of the pending proposal.
     */
    async authorizeTopologyTransaction(
        transactionHashHex: string,
        options: { retries?: number; retryDelayMs?: number } = {},
    ): Promise<void> {
        const { retries = 10, retryDelayMs = 2_000 } = options;
        const synchronizerId = await this.#getSynchronizerId();
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                await this.#topologyWrite.authorize(
                    AuthorizeRequest.create({
                        type: { oneofKind: 'transactionHash', transactionHash: transactionHashHex },
                        mustFullyAuthorize: false,
                        store: synchronizerStore(synchronizerId),
                    }),
                    { meta: await this.#getMeta() },
                );
                return;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                // addTransactions is async — the proposal may not yet be visible.
                if (msg.includes(TOPOLOGY_TRANSACTION_NOT_FOUND) && attempt < retries) {
                    await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
                    continue;
                }
                throw err;
            }
        }
    }

    /** Closes the underlying gRPC transport. */
    close(): void {
        this.#transport.close();
    }
}
