import { PreparedTransaction as PreparedTransactionProto } from '@canton-network/core-ledger-proto';
import type { ContractId } from '@daml/types';
import { once } from 'es-toolkit';
import { randomUUID } from 'node:crypto';

import {
    CantonApiError,
    cantonApiErrorFromResponse,
    CantonProtocolError,
    CantonTransportError,
} from '../errors';
import {
    DefaultApi,
    type PostV2CommandsAsyncSubmitRequest,
    type PostV2CommandsCompletionsRequest,
    type PostV2DarsRequest,
    type PostV2DarsValidateRequest,
    type PostV2EventsEventsByContractIdRequest,
    type PostV2InteractiveSubmissionExecuteRequest,
    type PostV2InteractiveSubmissionPreferredPackagesRequest,
    type PostV2InteractiveSubmissionPrepareRequest,
    type PostV2PartiesExternalAllocateRequest,
    type PostV2PartiesExternalGenerateTopologyRequest,
} from '../open-api/apis/DefaultApi';
import {
    type ArchivedEvent,
    type Command,
    type CreatedEvent,
    type CumulativeFilter,
    type DisclosedContract,
    type JsActiveContract,
    JsActiveContractFromJSON,
} from '../open-api/models';
import { type Configuration, ResponseError } from '../open-api/runtime';
import type { CantonDisclosedContract } from '../transaction';
import type {
    ExternalSignature,
    PreparedTransaction,
    PreparedTransactionWithExpiry,
    SubmitActors,
    SubmitResult,
    UserRight,
    WaitOptions,
    WaitRejected,
    WaitResult,
    WaitWithExpiryResult,
} from '../types';
import {
    type AmuletContextOptions,
    type AmuletContextResult,
    type AmuletTransferFactoryArgs,
    type CantonClientWalletConfig,
    fetchAcceptContext,
    fetchAmuletContext,
    fetchAmuletTransferFactoryContext,
    fetchDsoParty,
    fetchTransferInstructionContext,
    injectExternalPartyAmuletRules,
    type InstrumentId,
    type TransferInstructionAcceptContextResult,
    type TransferInstructionChoice,
} from './amulet';
import type {
    CantonTransaction,
    CantonUpdate,
    CantonUpdateResponse,
    ICantonClient,
} from './interface';

/**
 * CantonClient - The engine layer for Canton ledger operations.
 *
 * Responsibilities:
 * - Synchronizer discovery and caching
 * - Command submission and completion waiting
 * - Disclosed contract building
 * - JSON normalization (temporary workaround)
 *
 * This class uses composition (not inheritance) to wrap the generated API,
 * exposing only the minimal surface needed for ledger app operations.
 */
export class CantonClient implements ICantonClient {
    readonly #api: DefaultApi;
    readonly #userId: string;
    readonly #wallet?: CantonClientWalletConfig;
    #dsoParty?: string;

    constructor(
        config: Configuration,
        userId: string = 'participant_admin',
        wallet?: CantonClientWalletConfig,
    ) {
        this.#api = new DefaultApi(config);
        this.#userId = userId;
        this.#wallet = wallet;
    }

    #requireWallet(): CantonClientWalletConfig {
        if (!this.#wallet) {
            throw new CantonProtocolError(
                'CantonClient has no wallet config (walletUrl + tokenProvider); amulet endpoints are unavailable',
            );
        }
        return this.#wallet;
    }

    async getDsoParty(): Promise<string> {
        const { walletUrl, tokenProvider } = this.#requireWallet();
        if (this.#dsoParty) return this.#dsoParty;
        this.#dsoParty = await fetchDsoParty(walletUrl, await tokenProvider.getToken());
        return this.#dsoParty;
    }

    async getAmuletTransferFactoryContext(args: AmuletTransferFactoryArgs) {
        const { walletUrl, tokenProvider } = this.#requireWallet();
        return fetchAmuletTransferFactoryContext(walletUrl, await tokenProvider.getToken(), args);
    }

    async getTransferInstructionContext(args: {
        contractId: string;
        choice: TransferInstructionChoice;
    }): Promise<TransferInstructionAcceptContextResult> {
        const { walletUrl, tokenProvider } = this.#requireWallet();
        return fetchTransferInstructionContext({
            ...args,
            walletUrl,
            token: await tokenProvider.getToken(),
        });
    }

    async getTransferInstructionAcceptContext({
        contractId,
    }: {
        contractId: string;
    }): Promise<TransferInstructionAcceptContextResult> {
        const { walletUrl, tokenProvider } = this.#requireWallet();
        return fetchAcceptContext({ walletUrl, token: await tokenProvider.getToken(), contractId });
    }

    /** Amulet ChoiceContext with ExternalPartyAmuletRules injected — required by every flow hitting FeeUtils.validateContext. */
    async getAmuletContextWithExternalRules(
        instrumentId: InstrumentId,
        options?: AmuletContextOptions,
    ): Promise<AmuletContextResult> {
        const { walletUrl, tokenProvider } = this.#requireWallet();
        const { amuletContext, disclosedContracts } = await fetchAmuletContext(
            walletUrl,
            await tokenProvider.getToken(),
            instrumentId,
            options,
        );
        const { amuletContext: contextWithRules, externalPartyAmuletRulesCid } =
            injectExternalPartyAmuletRules(amuletContext, disclosedContracts);
        return { amuletContext: contextWithRules, disclosedContracts, externalPartyAmuletRulesCid };
    }

    /**
     * Get a property from an object, trying PascalCase first then camelCase.
     * Canton API returns PascalCase but OpenAPI expects camelCase.
     */
    #getField<T>(obj: Record<string, unknown> | undefined, key: string): T | undefined {
        if (!obj) return undefined;
        const pascal = key.charAt(0).toUpperCase() + key.slice(1);
        const camel = key.charAt(0).toLowerCase() + key.slice(1);
        return (obj[pascal] ?? obj[camel]) as T | undefined;
    }

    /**
     * Run an API call, normalizing a thrown `ResponseError` into a `CantonApiError`
     * that carries `errorCategory` (for retry classification). Other errors pass through.
     */
    async #invoke<T>(call: () => Promise<T>): Promise<T> {
        try {
            return await call();
        } catch (err) {
            if (err instanceof ResponseError) {
                throw await cantonApiErrorFromResponse(err.response);
            }
            throw err;
        }
    }

    /**
     * Build party-based filter object for event queries.
     */
    #buildPartyFilters(parties: string[], includeCreatedEventBlob: boolean) {
        return Object.fromEntries(
            parties.map((p) => [
                p,
                {
                    cumulative: [
                        {
                            identifierFilter: {
                                wildcardFilter: { value: { includeCreatedEventBlob } },
                            },
                        },
                    ],
                },
            ]),
        );
    }

    /**
     * Validate and extract disclosure fields from a CreatedEvent.
     */
    #validateDisclosureEvent(
        event: { templateId?: string; contractId?: string; createdEventBlob?: string },
        contractId: ContractId<unknown>,
    ): { templateId: string; contractId: string; createdEventBlob: string } {
        if (!event.templateId) {
            throw new CantonProtocolError('Disclosure response missing templateId', {
                contractId,
            });
        }
        if (!event.contractId) {
            throw new CantonProtocolError('Disclosure response missing contractId', {
                contractId,
            });
        }
        if (!event.createdEventBlob) {
            throw new CantonProtocolError('Disclosure response missing createdEventBlob', {
                contractId,
            });
        }
        return {
            templateId: event.templateId,
            contractId: event.contractId,
            createdEventBlob: event.createdEventBlob,
        };
    }

    /**
     * Validate and extract prepared transaction fields from a prepare response.
     */
    #validatePrepareResponse(response: {
        preparedTransaction?: string;
        preparedTransactionHash?: string;
        hashingSchemeVersion?: string;
    }): {
        preparedTransaction: string;
        preparedTransactionHash: string;
        hashingSchemeVersion: string;
    } {
        if (!response.preparedTransaction) {
            throw new CantonProtocolError('Prepare response missing preparedTransaction');
        }
        if (!response.preparedTransactionHash) {
            throw new CantonProtocolError('Prepare response missing preparedTransactionHash');
        }
        if (!response.hashingSchemeVersion) {
            throw new CantonProtocolError('Prepare response missing hashingSchemeVersion');
        }
        return {
            preparedTransaction: response.preparedTransaction,
            preparedTransactionHash: response.preparedTransactionHash,
            hashingSchemeVersion: response.hashingSchemeVersion,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Synchronizer Discovery
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns all connected synchronizer IDs.
     */
    async connectedSynchronizers(): Promise<string[]> {
        const response = await this.#invoke(() => this.#api.getV2StateConnectedSynchronizers());

        return response.connectedSynchronizers?.map(({ synchronizerId }) => synchronizerId) ?? [];
    }

    async getLocalParticipantId(): Promise<string> {
        const response = await this.#invoke(() => this.#api.getV2PartiesParticipantId());
        return response.participantId;
    }

    /**
     * Internal: ensures we have a cached synchronizer ID, fetching if needed.
     */
    #ensureSynchronizerId = once(async (): Promise<string> => {
        const [id] = await this.connectedSynchronizers();

        if (!id) {
            throw new CantonTransportError('No connected synchronizers found');
        }

        return id;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // DAR Upload / Validation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Upload a DAR (Daml Archive) to the participant node.
     *
     * @param dar - Raw DAR bytes.
     * @param opts.vetAllPackages - Whether to vet all packages in the DAR.
     * @param opts.synchronizerId - Synchronizer to upload to (auto-detected if omitted).
     * @param opts.skipIfVetted - If true, silently succeeds when the DAR is already vetted.
     */
    async uploadDar(
        dar: Uint8Array<ArrayBuffer>,
        opts: { vetAllPackages?: boolean; synchronizerId?: string; skipIfVetted?: boolean } = {},
    ): Promise<object> {
        // Extract the underlying ArrayBuffer, handling views that don't start at offset 0
        const bytes =
            dar.byteOffset === 0 && dar.byteLength === dar.buffer.byteLength
                ? dar.buffer
                : dar.buffer.slice(dar.byteOffset, dar.byteOffset + dar.byteLength);
        const body = new Blob([bytes], { type: 'application/octet-stream' });
        const synchronizerId = opts.synchronizerId ?? (await this.#ensureSynchronizerId());
        const request: PostV2DarsRequest = {
            body,
            vetAllPackages: opts.vetAllPackages,
            synchronizerId,
        };

        try {
            return await this.#invoke(() => this.#api.postV2Dars(request));
        } catch (err: unknown) {
            // If skipIfVetted, treat KNOWN_PACKAGE_VERSION as a no-op success
            if (
                opts.skipIfVetted &&
                err instanceof CantonApiError &&
                err.code === 'KNOWN_PACKAGE_VERSION'
            ) {
                return { skipped: true, reason: 'already_vetted', details: err.body };
            }
            throw err;
        }
    }

    /**
     * Validate a DAR against the participant without uploading it.
     *
     * @param dar - Raw DAR bytes.
     * @param opts.synchronizerId - Synchronizer to validate against (auto-detected if omitted).
     */
    async validateDar(
        dar: Uint8Array<ArrayBuffer>,
        opts: { synchronizerId?: string } = {},
    ): Promise<void> {
        const bytes =
            dar.byteOffset === 0 && dar.byteLength === dar.buffer.byteLength
                ? dar.buffer
                : dar.buffer.slice(dar.byteOffset, dar.byteOffset + dar.byteLength);
        const body = new Blob([bytes], { type: 'application/octet-stream' });
        const request: PostV2DarsValidateRequest = {
            body,
            synchronizerId: opts.synchronizerId,
        };

        if (!request.synchronizerId) {
            return this.#ensureSynchronizerId().then((synchronizerId) =>
                this.#invoke(() => this.#api.postV2DarsValidate({ ...request, synchronizerId })),
            );
        }

        return this.#invoke(() => this.#api.postV2DarsValidate(request));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Party Management
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * List all known parties on the participant node.
     *
     * @param opts.pageSize - Maximum number of results per page
     * @param opts.pageToken - Pagination token from previous response
     * @returns Array of party IDs and pagination token
     */
    async listParties(
        opts: { pageSize?: number; pageToken?: string } = {},
    ): Promise<{ parties: string[]; nextPageToken?: string }> {
        const response = await this.#invoke(() =>
            this.#api.getV2Parties({
                pageSize: opts.pageSize,
                pageToken: opts.pageToken,
            }),
        );

        return {
            parties: response.partyDetails?.map((p) => p.party) ?? [],
            nextPageToken: response.nextPageToken,
        };
    }

    /**
     * Return the rights granted to the current user (this.#userId).
     *
     * Bypasses the OpenAPI generator's typed `Kind` converter, which is
     * broken: `instanceOfKindOneOf` checks lowercase `canActAs in value`, but
     * `KindOneOfFromJSONTyped` reads uppercase `json['CanActAs']`, so the
     * typed client returns every `kind` as `{}`. We parse the raw JSON
     * ourselves to preserve the actual variant payload.
     */
    async listUserRights(): Promise<UserRight[]> {
        const apiResponse = await this.#invoke(() =>
            this.#api.getV2UsersUserIdRightsRaw({
                userId: this.#userId,
            }),
        );
        const raw = (await apiResponse.raw.json()) as { rights?: UserRight[] };
        return raw.rights ?? [];
    }

    /**
     * Return the parties the current user has CanActAs or CanReadAs rights
     * for. Convenience wrapper over `listUserRights()` for the common case
     * where the caller just needs party-scoped access (e.g. to query events
     * or fetch transactions).
     *
     * Use this instead of `listParties()` when the caller only has scoped
     * rights — `listParties()` returns *all* parties on the participant
     * (including DSO, splice parties), and Canton returns 403 if you query
     * as a party you can't read.
     */
    async listUserParties(): Promise<string[]> {
        const rights = await this.listUserRights();
        const parties = new Set<string>();
        for (const right of rights) {
            // Only `CanActAs` / `CanReadAs` carry a party; the other four
            // variants (ParticipantAdmin, IdentityProviderAdmin,
            // CanReadAsAnyParty, CanExecuteAsAnyParty) have empty payloads.
            const party = right.kind.CanActAs?.value.party ?? right.kind.CanReadAs?.value.party;
            if (party !== undefined) {
                parties.add(party);
            }
        }
        return [...parties];
    }

    /**
     * Allocate a new party on the participant node.
     *
     * @param partyIdHint - A hint for the party ID (e.g., "alice", "bob")
     * @param opts.userId - User who gets actAs rights (empty string = no user)
     * @param opts.synchronizerId - Synchronizer to allocate on (auto-detected if omitted)
     * @param opts.identityProviderId - Identity provider ID (empty string = default)
     * @returns The allocated party ID
     */
    async allocateParty(
        partyIdHint: string,
        opts: { userId?: string; synchronizerId?: string; identityProviderId?: string } = {},
    ): Promise<string> {
        const synchronizerId = opts.synchronizerId ?? (await this.#ensureSynchronizerId());

        const response = await this.#invoke(() =>
            this.#api.postV2Parties({
                allocatePartyRequest: {
                    partyIdHint,
                    synchronizerId,
                    userId: opts.userId ?? '',
                    identityProviderId: opts.identityProviderId ?? '',
                },
            }),
        );

        const party = response.partyDetails?.party;
        if (!party) {
            throw new CantonProtocolError('Party allocation response missing party ID');
        }

        return party;
    }

    /**
     * Generate unsigned topology transactions for an external party.
     *
     * POST /v2/parties/external/generate-topology
     */
    async generateExternalPartyTopology(args: {
        partyHint: string;
        publicKey: { format: string; keyData: string; keySpec: string };
        localParticipantObservationOnly: boolean;
        confirmationThreshold: number;
    }): Promise<{
        partyId: string;
        topologyTransactions: string[];
        multiHash: string;
        synchronizerId: string;
    }> {
        const synchronizerId = await this.#ensureSynchronizerId();
        const request: PostV2PartiesExternalGenerateTopologyRequest = {
            generateExternalPartyTopologyRequest: {
                synchronizer: synchronizerId,
                partyHint: args.partyHint,
                publicKey: args.publicKey,
                localParticipantObservationOnly: args.localParticipantObservationOnly,
                confirmationThreshold: args.confirmationThreshold,
            },
        };

        const response = await this.#invoke(() =>
            this.#api.postV2PartiesExternalGenerateTopology(request),
        );

        if (!response.partyId || !response.multiHash) {
            throw new CantonProtocolError(
                'generateExternalPartyTopology response missing partyId or multiHash',
            );
        }

        if (!response.topologyTransactions?.length) {
            throw new CantonProtocolError(
                'generateExternalPartyTopology response missing topologyTransactions',
            );
        }

        return {
            partyId: response.partyId,
            topologyTransactions: response.topologyTransactions,
            multiHash: response.multiHash,
            synchronizerId,
        };
    }

    /**
     * Submit signed topology transactions to register an external party.
     *
     * POST /v2/parties/external/allocate
     */
    async allocateExternalParty(args: {
        synchronizerId: string;
        topologyTransactions: string[];
        multiHashSignatures: Array<{
            format: string;
            signature: string;
            signedBy: string;
            signingAlgorithmSpec: string;
        }>;
    }): Promise<string> {
        const request: PostV2PartiesExternalAllocateRequest = {
            allocateExternalPartyRequest: {
                synchronizer: args.synchronizerId,
                onboardingTransactions: args.topologyTransactions.map((tx) => ({
                    transaction: tx,
                })),
                multiHashSignatures: args.multiHashSignatures,
                identityProviderId: '',
            },
        };

        const response = await this.#invoke(() => this.#api.postV2PartiesExternalAllocate(request));

        if (!response.partyId) {
            throw new CantonProtocolError('allocateExternalParty response missing partyId');
        }

        return response.partyId;
    }

    /**
     * Grant canActAs right for a party to the current service user.
     * Idempotent — safe to call even if the right is already granted.
     *
     * POST /v2/users/{userId}/rights
     */
    async grantCanActAs(partyId: string): Promise<void> {
        await this.#invoke(() =>
            this.#api.postV2UsersUserIdRights({
                userId: this.#userId,
                grantUserRightsRequest: {
                    userId: this.#userId,
                    rights: [{ kind: { canActAs: { value: { party: partyId } } } }],
                    identityProviderId: '',
                },
            }),
        );
    }

    /**
     * Get the package ID for a package by name.
     *
     * @param packageName - The package name (e.g., "layerzero-oft")
     * @param parties - Parties whose vetting state should be considered
     * @param opts.synchronizerId - Synchronizer to query (auto-detected if omitted)
     * @returns The package ID (hash)
     */
    async getPackageId(
        packageName: string,
        parties: string[],
        opts: { synchronizerId?: string } = {},
    ): Promise<string> {
        const synchronizerId = opts.synchronizerId ?? (await this.#ensureSynchronizerId());

        const request: PostV2InteractiveSubmissionPreferredPackagesRequest = {
            getPreferredPackagesRequest: {
                packageVettingRequirements: [
                    {
                        packageName,
                        parties,
                    },
                ],
                synchronizerId,
            },
        };

        const response = await this.#invoke(() =>
            this.#api.postV2InteractiveSubmissionPreferredPackages(request),
        );

        const packageRef = response.packageReferences?.find(
            (ref) => ref.packageName === packageName,
        );
        if (!packageRef?.packageId) {
            throw new CantonProtocolError(
                `Package "${packageName}" not found or not vetted for parties`,
            );
        }

        return packageRef.packageId;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Command Submission
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Submit a batch of commands atomically.
     *
     * @returns commandId and completionOffset for use with waitForCommand()
     */
    async submit(
        actors: SubmitActors,
        commands: Command[],
        opts: { disclosedContracts?: DisclosedContract[]; commandId?: string } = {},
    ): Promise<SubmitResult> {
        const synchronizerId = await this.#ensureSynchronizerId();
        const commandId = opts.commandId ?? randomUUID();

        // Snapshot ledger end before submission so waitForCommand knows where to start polling
        const completionOffset = await this.getLedgerEndOffset();

        const request: PostV2CommandsAsyncSubmitRequest = {
            jsCommands: {
                commandId,
                actAs: actors.actAs,
                readAs: actors.readAs ?? actors.actAs,
                userId: this.#userId,
                synchronizerId,
                commands,
                disclosedContracts: opts.disclosedContracts,
            },
        };

        await this.#invoke(() => this.#api.postV2CommandsAsyncSubmit(request));

        return { commandId, completionOffset };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Completion Waiting / Reconciliation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wait for a command to be accepted or rejected.
     *
     * Uses bounded exponential backoff to avoid hammering the participant.
     */
    async waitForCommand(commandId: string, opts: WaitOptions): Promise<WaitResult> {
        const { parties, timeoutMs = 30_000, poll = {} } = opts;

        const limit = poll.limit ?? 50;
        const streamIdleTimeoutMs = poll.streamIdleTimeoutMs ?? 1000;
        const initialBackoffMs = poll.backoffMs?.initial ?? 100;
        const maxBackoffMs = poll.backoffMs?.max ?? 5000;

        let beginExclusive = opts.beginExclusive ?? 0;
        let currentBackoff = initialBackoffMs;
        const deadline = Date.now() + timeoutMs;

        // Poll the completions stream until we find our commandId or timeout
        while (Date.now() < deadline) {
            const request: PostV2CommandsCompletionsRequest = {
                completionStreamRequest: {
                    beginExclusive,
                    parties,
                    userId: this.#userId,
                },
                limit,
                streamIdleTimeoutMs,
            };

            const rawResponse = await this.#invoke(() =>
                this.#api.postV2CommandsCompletionsRaw(request),
            );
            const responseText = await rawResponse.raw.text();
            const completions = JSON.parse(responseText) as unknown[];

            // Scan each completion for our commandId
            for (const item of completions) {
                const normalized = item as Record<string, unknown>;
                const completionResponse = this.#getField<Record<string, unknown>>(
                    normalized,
                    'completionResponse',
                );
                if (!completionResponse) continue;

                // Handle offsetCheckpoint responses (no commandId)
                const offsetCheckpoint = this.#getField<Record<string, unknown>>(
                    completionResponse,
                    'offsetCheckpoint',
                );
                if (offsetCheckpoint) {
                    const checkpoint =
                        this.#getField<Record<string, unknown>>(offsetCheckpoint, 'value') ??
                        offsetCheckpoint;
                    const checkpointOffset = this.#getField<number>(checkpoint, 'offset');
                    if (checkpointOffset !== undefined) {
                        beginExclusive = Math.max(beginExclusive, checkpointOffset);
                    }
                    continue;
                }

                // Navigate: completionResponse.completion.value
                const completionWrapper = this.#getField<Record<string, unknown>>(
                    completionResponse,
                    'completion',
                );
                const completion =
                    this.#getField<Record<string, unknown>>(completionWrapper, 'value') ??
                    completionWrapper;
                if (!completion) continue;

                const offset = this.#getField<number>(completion, 'offset');
                const completionCommandId = this.#getField<string>(completion, 'commandId');

                // Found our command — check gRPC status to determine accept/reject
                if (completionCommandId === commandId) {
                    const status = this.#getField<{
                        code?: number;
                        message?: string;
                        details?: unknown;
                    }>(completion, 'status');

                    // code === 0 or status undefined means success (gRPC OK)
                    if (!status || status.code === 0) {
                        return {
                            status: 'accepted',
                            commandId,
                            updateId: this.#getField<string>(completion, 'updateId') ?? '',
                            offset: offset ?? 0,
                        };
                    } else {
                        return {
                            status: 'rejected',
                            commandId,
                            offset: offset ?? 0,
                            error: {
                                code: status.code,
                                message: status.message ?? 'Unknown rejection',
                                details: status.details,
                            },
                        };
                    }
                }

                // Not our command — advance offset cursor past it
                if (offset !== undefined) {
                    beginExclusive = Math.max(beginExclusive, offset);
                }
            }

            // Bounded exponential backoff
            const remainingTime = deadline - Date.now();
            const sleepTime = Math.min(currentBackoff, remainingTime, maxBackoffMs);
            if (sleepTime > 0) {
                await new Promise((resolve) => setTimeout(resolve, sleepTime));
            }
            currentBackoff = Math.min(currentBackoff * 2, maxBackoffMs);
        }

        return { status: 'timeout', commandId, lastCheckedOffset: beginExclusive };
    }

    async #assertCommandSource(expiry: PreparedTransactionWithExpiry['expiry']): Promise<void> {
        if (
            !expiry.userId ||
            expiry.userId !== this.#userId ||
            !expiry.participantId ||
            expiry.participantId !== (await this.getLocalParticipantId())
        ) {
            throw new CantonProtocolError(
                'Command source differs from the preparing participant or user',
            );
        }
    }

    async waitForCommandWithExpiry(
        commandId: string,
        opts: Omit<WaitOptions, 'beginExclusive'> & {
            expiry: PreparedTransactionWithExpiry['expiry'];
        },
    ): Promise<WaitWithExpiryResult> {
        const { expiry, parties, timeoutMs = 30_000, poll = {} } = opts;
        await this.#assertCommandSource(expiry);
        let beginExclusive = expiry.completionOffset;
        const maxRecordTime = Date.parse(expiry.maxRecordTime);
        if (
            !Number.isSafeInteger(beginExclusive) ||
            beginExclusive < 0 ||
            !Number.isFinite(maxRecordTime) ||
            !expiry.synchronizerId
        ) {
            throw new CantonProtocolError('Invalid command expiry metadata');
        }
        const deadline = Date.now() + timeoutMs;
        let backoffMs = poll.backoffMs?.initial ?? 100;
        let rejection: WaitRejected | undefined;
        while (Date.now() < deadline) {
            const previousOffset = beginExclusive;
            const response = await this.#invoke(() =>
                this.#api.postV2CommandsCompletionsRaw({
                    completionStreamRequest: { beginExclusive, parties, userId: this.#userId },
                    limit: poll.limit ?? 50,
                    streamIdleTimeoutMs: poll.streamIdleTimeoutMs ?? 1000,
                }),
            );
            const entries = (await response.raw.json()) as Record<string, unknown>[];
            let expired = false;
            for (const entry of entries) {
                const item = this.#getField<Record<string, unknown>>(entry, 'completionResponse');
                const checkpointWrapper = this.#getField<Record<string, unknown>>(
                    item,
                    'offsetCheckpoint',
                );
                const checkpoint =
                    this.#getField<Record<string, unknown>>(checkpointWrapper, 'value') ??
                    checkpointWrapper;
                const completionWrapper = this.#getField<Record<string, unknown>>(
                    item,
                    'completion',
                );
                const completion =
                    this.#getField<Record<string, unknown>>(completionWrapper, 'value') ??
                    completionWrapper;
                if (!checkpoint && !completion) {
                    if (this.#getField<unknown>(item, 'empty') !== undefined) continue;
                    throw new CantonProtocolError('Unrecognized command completion response');
                }
                const offset = this.#getField<number>(checkpoint ?? completion, 'offset');
                if (!Number.isSafeInteger(offset) || offset! < 0) {
                    throw new CantonProtocolError('Invalid command completion offset');
                }
                if (checkpoint) {
                    const times = this.#getField<
                        Array<{ synchronizerId: string; recordTime: string }>
                    >(checkpoint, 'synchronizerTimes');
                    expired ||=
                        offset! >= beginExclusive &&
                        !!times?.some(
                            (time) =>
                                time.synchronizerId === expiry.synchronizerId &&
                                Date.parse(time.recordTime) > maxRecordTime,
                        );
                } else if (this.#getField<string>(completion, 'commandId') === commandId) {
                    const status = this.#getField<{
                        code?: number;
                        message?: string;
                        details?: unknown;
                    }>(completion, 'status');
                    if (
                        status &&
                        (!Number.isInteger(status.code) || status.code! < 0 || status.code! > 16)
                    ) {
                        throw new CantonProtocolError('Invalid command completion status');
                    }
                    if (!status || status.code === 0) {
                        const updateId = this.#getField<string>(completion, 'updateId');
                        if (!updateId)
                            throw new CantonProtocolError('Accepted command is missing updateId');
                        return { status: 'accepted', commandId, updateId, offset: offset! };
                    }
                    rejection = {
                        status: 'rejected',
                        commandId,
                        offset: offset!,
                        error: {
                            code: status.code,
                            message: status.message ?? 'Unknown rejection',
                            details: status.details,
                        },
                    };
                }
                beginExclusive = Math.max(beginExclusive, offset!);
            }
            // A rejection can belong to a resubmission; only the checkpoint rules out later acceptance.
            if (expired) return rejection ?? { status: 'expired', commandId };
            if (beginExclusive > previousOffset) {
                backoffMs = poll.backoffMs?.initial ?? 100;
                continue;
            }
            const delay = Math.min(backoffMs, poll.backoffMs?.max ?? 5000, deadline - Date.now());
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            backoffMs = Math.min(backoffMs * 2, poll.backoffMs?.max ?? 5000);
        }
        return { status: 'timeout', commandId, lastCheckedOffset: beginExclusive };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Disclosed Contracts
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fetch active contract's created event by ID.
     * Returns undefined if contract doesn't exist or is archived.
     */
    async #fetchActiveContractEvent(
        contractId: ContractId<unknown>,
        parties: string[],
        includeCreatedEventBlob: boolean,
        interfaceIds?: string[],
    ): Promise<CreatedEvent | undefined> {
        const request: PostV2EventsEventsByContractIdRequest = {
            getEventsByContractIdRequest: {
                contractId,
                eventFormat: {
                    filtersByParty: interfaceIds?.length
                        ? Object.fromEntries(
                              parties.map((party) => [
                                  party,
                                  {
                                      cumulative: this.#buildInterfaceCumulativeFilters(
                                          interfaceIds,
                                          includeCreatedEventBlob,
                                      ),
                                  },
                              ]),
                          )
                        : this.#buildPartyFilters(parties, includeCreatedEventBlob),
                    verbose: false,
                },
            },
        };

        const response = await this.#invoke(() =>
            this.#api.postV2EventsEventsByContractId(request),
        );

        // If archived, contract is not active
        if (response.archived) return undefined;

        return response.created?.createdEvent;
    }

    /**
     * Build a disclosure for a contract.
     *
     * @param contractId - The contract ID to create disclosure for
     * @param parties - Parties that have visibility to the contract
     * @returns DisclosedContract if visible, undefined if not found
     * @throws CantonProtocolError if contract visible but blob missing (server/config mismatch)
     */
    async createDisclosure(
        contractId: ContractId<unknown>,
        parties: string[],
    ): Promise<CantonDisclosedContract | undefined> {
        const synchronizerId = await this.#ensureSynchronizerId();
        const created = await this.#fetchActiveContractEvent(contractId, parties, true);

        if (!created) return undefined;

        const validated = this.#validateDisclosureEvent(created, contractId);
        return {
            ...validated,
            synchronizerId,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: Active Contract Queries (used by CantonSdk)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fetch a single contract by ID.
     *
     * @param contractId The contract ID to fetch
     * @param parties Parties to use for filtering (required for non-admin tokens)
     */
    async fetchContractById(
        contractId: ContractId<unknown>,
        parties: string[],
        opts?: { interfaceIds?: string[] },
    ): Promise<CreatedEvent | undefined> {
        return this.#fetchActiveContractEvent(contractId, parties, false, opts?.interfaceIds);
    }

    /**
     * Fetch both the created and archived events for a contract by ID.
     * Unlike fetchContractById, this preserves archival information.
     */
    async fetchEventsByContractId(
        contractId: string,
        parties: string[],
    ): Promise<{ created: CreatedEvent | undefined; archived: ArchivedEvent | undefined }> {
        const request: PostV2EventsEventsByContractIdRequest = {
            getEventsByContractIdRequest: {
                contractId,
                eventFormat: {
                    filtersByParty: this.#buildPartyFilters(parties, false),
                    verbose: false,
                },
            },
        };

        const response = await this.#invoke(() =>
            this.#api.postV2EventsEventsByContractId(request),
        );

        return {
            created: response.created?.createdEvent,
            archived: response.archived?.archivedEvent,
        };
    }

    /**
     * Fetch an update (transaction) by its ID.
     * @param updateId The update ID from a completion
     * @param parties Parties to use for the query filter
     * @returns The full update response
     */
    async fetchTransactionByUpdateId(
        updateId: string,
        parties: string[],
    ): Promise<CantonTransaction> {
        const response = await this.#invoke(() =>
            this.#api.postV2UpdatesUpdateByIdRaw({
                getUpdateByIdRequest: {
                    updateId,
                    updateFormat: this.#buildUpdateFormat(parties),
                },
            }),
        );

        const updateResponse: CantonUpdateResponse = await response.raw.json();
        return this.#parseTransactionFromUpdate(
            updateResponse,
            `Update ${updateId} is not a transaction`,
        );
    }

    /**
     * Fetch a transaction by its offset.
     * @param offset - The ledger offset
     * @param parties - Parties to use for the query filter
     * @returns The full transaction including recordTime
     */
    async fetchTransactionByOffset(offset: number, parties: string[]): Promise<CantonTransaction> {
        const response = await this.#invoke(() =>
            this.#api.postV2UpdatesUpdateByOffsetRaw({
                getUpdateByOffsetRequest: {
                    offset,
                    updateFormat: this.#buildUpdateFormat(parties),
                },
            }),
        );

        const updateResponse: CantonUpdateResponse = await response.raw.json();
        return this.#parseTransactionFromUpdate(
            updateResponse,
            `Update at offset ${offset} is not a transaction`,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // External Party / Interactive Submission
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Prepare commands for external party signing.
     *
     * Returns a typed PreparedTransaction that preserves the contract type
     * through the signing flow. After signing, use submitSigned() to submit.
     *
     * @typeparam T The contract payload type (phantom type for type safety)
     *
     * @example
     * ```ts
     * const prepared = await client.prepareForSigning<Oft>({ actAs: [party] }, [cmd]);
     * const signature = await sign(prepared.preparedTransactionHash);
     * await client.submitSigned(prepared, [signature]);
     * ```
     */
    prepareForSigning(
        actors: SubmitActors,
        commands: Command[],
        opts: {
            disclosedContracts?: DisclosedContract[];
            commandId?: string;
            maxRecordTime: string;
        },
    ): Promise<PreparedTransactionWithExpiry>;
    prepareForSigning(
        actors: SubmitActors,
        commands: Command[],
        opts?: {
            disclosedContracts?: DisclosedContract[];
            commandId?: string;
            maxRecordTime?: undefined;
        },
    ): Promise<PreparedTransaction>;
    async prepareForSigning(
        actors: SubmitActors,
        commands: Command[],
        opts: {
            disclosedContracts?: DisclosedContract[];
            commandId?: string;
            maxRecordTime?: string;
        } = {},
    ): Promise<PreparedTransaction | PreparedTransactionWithExpiry> {
        const synchronizerId = await this.#ensureSynchronizerId();
        const commandId = opts.commandId ?? randomUUID();

        let expiry: PreparedTransactionWithExpiry['expiry'] | undefined;
        if (opts.maxRecordTime !== undefined) {
            const [participantId, completionOffset] = await Promise.all([
                this.getLocalParticipantId(),
                this.getLedgerEndOffset(),
            ]);
            expiry = {
                maxRecordTime: opts.maxRecordTime,
                synchronizerId,
                participantId,
                userId: this.#userId,
                completionOffset,
            };
        }

        const request: PostV2InteractiveSubmissionPrepareRequest = {
            jsPrepareSubmissionRequest: {
                userId: this.#userId,
                commandId,
                commands,
                actAs: actors.actAs,
                readAs: actors.readAs ?? actors.actAs,
                disclosedContracts: opts.disclosedContracts,
                synchronizerId,
                verboseHashing: false,
                ...(expiry
                    ? {
                          maxRecordTime: expiry.maxRecordTime,
                          hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3' as const,
                      }
                    : {}),
                packageIdSelectionPreference: [],
            },
        };

        const response = await this.#invoke(() =>
            this.#api.postV2InteractiveSubmissionPrepare(request),
        );
        const validated = this.#validatePrepareResponse(response);

        if (expiry) {
            const metadata = PreparedTransactionProto.fromBinary(
                Buffer.from(validated.preparedTransaction, 'base64'),
            ).metadata;
            const deadline = Date.parse(expiry.maxRecordTime);
            if (
                !Number.isFinite(deadline) ||
                validated.hashingSchemeVersion !== 'HASHING_SCHEME_VERSION_V3' ||
                metadata?.maxRecordTime !== BigInt(deadline) * 1000n
            ) {
                throw new CantonProtocolError(
                    'Prepared transaction does not contain the requested signed maxRecordTime',
                );
            }
            return {
                ...validated,
                hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3',
                commandId,
                expiry,
            };
        }

        return {
            ...validated,
            hashingSchemeVersion:
                validated.hashingSchemeVersion as PreparedTransaction['hashingSchemeVersion'],
            commandId,
        };
    }

    /**
     * Submit a pre-signed transaction.
     *
     * The generic type T flows from prepareForSigning() for type documentation.
     */
    async submitSigned(
        prepared: PreparedTransaction | PreparedTransactionWithExpiry,
        signatures: ExternalSignature[],
    ): Promise<SubmitResult> {
        const expiry = 'expiry' in prepared ? prepared.expiry : undefined;
        if (expiry) await this.#assertCommandSource(expiry);
        const completionOffset = expiry?.completionOffset ?? (await this.getLedgerEndOffset());
        if (expiry && Date.now() >= Date.parse(expiry.maxRecordTime)) {
            return { commandId: prepared.commandId, completionOffset };
        }

        const request: PostV2InteractiveSubmissionExecuteRequest = {
            jsExecuteSubmissionRequest: {
                preparedTransaction: prepared.preparedTransaction,
                // Map each ExternalSignature into the Canton per-party signature format
                partySignatures: {
                    signatures: signatures.map((sig) => ({
                        party: sig.party,
                        signatures: [
                            {
                                format: sig.format,
                                signature: sig.signature,
                                signedBy: sig.signedBy,
                                signingAlgorithmSpec: sig.signingAlgorithmSpec,
                            },
                        ],
                    })),
                },
                deduplicationPeriod: {
                    deduplicationDuration: {
                        value: { seconds: 3600, nanos: 0 }, // 1 hour default
                    },
                },
                submissionId: randomUUID(),
                userId: this.#userId,
                hashingSchemeVersion: prepared.hashingSchemeVersion,
            },
        };

        await this.#invoke(() => this.#api.postV2InteractiveSubmissionExecute(request));

        return { commandId: prepared.commandId, completionOffset };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Active Contracts Query
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get the current ledger end offset.
     */
    async getLedgerEndOffset(): Promise<number> {
        const response = await this.#invoke(() => this.#api.getV2StateLedgerEnd());
        return response.offset ?? 0;
    }

    /**
     * Query active contracts at a given offset with optional template filtering.
     *
     * @param party - Party to query as
     * @param offset - Ledger offset for the snapshot
     * @param opts.templateIds - Optional template IDs to filter by
     * @param opts.limit - Maximum number of contracts to return
     * @param opts.includeCreatedEventBlob - Include CIP disclosure blobs (default false)
     */
    async queryActiveContracts(
        party: string,
        offset: number,
        opts?: { templateIds?: string[]; limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]> {
        return this.queryActiveContractsByParties([party], offset, opts?.templateIds ?? [], {
            limit: opts?.limit,
            includeCreatedEventBlob: opts?.includeCreatedEventBlob,
        });
    }

    /**
     * Query active contracts visible to any of the given parties.
     *
     * Single API call with all parties in filtersByParty.
     *
     * @param parties - Parties to query as (for visibility)
     * @param offset - Ledger offset for the snapshot
     * @param templateIds - Template IDs to filter by
     * @param opts.limit - Maximum number of contracts to return
     * @param opts.includeCreatedEventBlob - Include CIP disclosure blobs (default false)
     */
    async queryActiveContractsByParties(
        parties: string[],
        offset: number,
        templateIds: string[],
        opts?: { limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]> {
        return this.#fetchActiveContracts(
            parties,
            offset,
            this.#buildCumulativeFilters(templateIds, opts?.includeCreatedEventBlob),
            opts,
        );
    }

    /**
     * Query active contracts visible to any of the given parties that implement
     * the given interfaces.
     *
     * @param parties - Parties to query as (for visibility)
     * @param offset - Ledger offset for the snapshot
     * @param interfaceIds - Interface IDs to filter by (e.g. "#package:Module:Interface")
     * @param opts.limit - Maximum number of contracts to return
     */
    async queryActiveContractsByInterface(
        parties: string[],
        offset: number,
        interfaceIds: string[],
        opts?: { limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]> {
        return this.#fetchActiveContracts(
            parties,
            offset,
            this.#buildInterfaceCumulativeFilters(interfaceIds, opts?.includeCreatedEventBlob),
            opts,
        );
    }

    async #fetchActiveContracts(
        parties: string[],
        offset: number,
        cumulativeFilter: CumulativeFilter[],
        opts?: { limit?: number },
    ): Promise<JsActiveContract[]> {
        const filtersByParty = Object.fromEntries(
            parties.map((party) => [party, { cumulative: cumulativeFilter }]),
        );

        // `eventFormat` replaces the legacy `filter` + `verbose: true` fields, which Canton 3.6
        // rejects by default (DEPRECATED_API_DISABLED) and 3.7 removes.
        const rawResponse = await this.#invoke(() =>
            this.#api.postV2StateActiveContractsRaw({
                getActiveContractsRequest: {
                    eventFormat: { filtersByParty, verbose: false },
                    activeAtOffset: offset,
                },
                limit: opts?.limit,
            }),
        );

        // Raw response is an array of streamed entries; extract and deserialize contracts
        type RawActiveContractsResponse = Array<{
            contractEntry?: { JsActiveContract?: Record<string, unknown> };
        }>;
        const rawJson: RawActiveContractsResponse = await rawResponse.raw.json();

        return rawJson
            .map((item) => item.contractEntry?.JsActiveContract)
            .filter((contract): contract is Record<string, unknown> => contract != null)
            .map((contract) => JsActiveContractFromJSON(contract));
    }

    /**
     * Stream transactions from a given offset.
     *
     * Uses `updateFormat` with `TRANSACTION_SHAPE_LEDGER_EFFECTS` so consumers
     * receive `ExercisedEvent`s (e.g. the request-poller depends on
     * `Request_Create` exercise results). The deprecated legacy `filter`
     * shape would default to `ACS_DELTA`, which only emits Created/Archived
     * events and silently drops every exercise on the wire.
     *
     * @param party - Party to query as
     * @param beginExclusive - Start offset (exclusive)
     * @param endInclusive - End offset (inclusive)
     * @param opts.templateIds - Optional template IDs to filter by
     * @param opts.limit - Maximum number of transactions to return
     */
    async getUpdates(
        party: string,
        beginExclusive: number,
        endInclusive: number,
        opts?: { templateIds?: string[]; limit?: number },
    ): Promise<CantonUpdate[]> {
        const eventFormat = {
            filtersByParty: {
                [party]: { cumulative: this.#buildCumulativeFilters(opts?.templateIds) },
            },
            verbose: false,
        };
        const rawResponse = await this.#invoke(() =>
            this.#api.postV2UpdatesRaw({
                getUpdatesRequest: {
                    beginExclusive,
                    endInclusive,
                    updateFormat: {
                        includeTransactions: {
                            eventFormat,
                            transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS' as const,
                        },
                    },
                },
                limit: opts?.limit,
            }),
        );

        const updateResponses: CantonUpdateResponse[] = await rawResponse.raw.json();

        return updateResponses.map((response) => response.update);
    }

    /**
     * Build cumulative filters for party-based queries.
     * If templateIds provided, filters by those templates; otherwise uses wildcard.
     */
    #buildCumulativeFilters(
        templateIds?: string[],
        includeCreatedEventBlob = false,
    ): CumulativeFilter[] {
        if (templateIds?.length) {
            return templateIds.map((templateId) => ({
                identifierFilter: {
                    templateFilter: { value: { templateId, includeCreatedEventBlob } },
                },
            }));
        }
        return [
            {
                identifierFilter: {
                    wildcardFilter: { value: { includeCreatedEventBlob } },
                },
            },
        ];
    }

    /**
     * Build cumulative filters for interface-based ACS queries.
     * If interfaceIds provided, filters by those interfaces; otherwise uses wildcard.
     */
    #buildInterfaceCumulativeFilters(
        interfaceIds?: string[],
        includeCreatedEventBlob = false,
    ): CumulativeFilter[] {
        if (interfaceIds?.length) {
            return interfaceIds.map((interfaceId) => ({
                identifierFilter: {
                    interfaceFilter: {
                        value: {
                            interfaceId,
                            includeInterfaceView: true,
                            includeCreatedEventBlob,
                        },
                    },
                },
            }));
        }
        return [
            {
                identifierFilter: {
                    wildcardFilter: { value: { includeCreatedEventBlob } },
                },
            },
        ];
    }

    /**
     * Build the standard update format for fetching transactions.
     */
    #buildUpdateFormat(parties: string[]) {
        return {
            includeTransactions: {
                eventFormat: {
                    filtersByParty: this.#buildPartyFilters(parties, false),
                    verbose: false,
                },
                transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS' as const,
            },
        };
    }

    /**
     * Parse an update response and extract the transaction.
     * The response structure is: { update: { Transaction: { value: CantonTransaction } } }
     */
    #parseTransactionFromUpdate(
        json: CantonUpdateResponse,
        notFoundMessage: string,
    ): CantonTransaction {
        // Update can be a Transaction, Reassignment, TopologyTransaction, or OffsetCheckpoint
        if (!('Transaction' in json.update)) {
            throw new CantonProtocolError(notFoundMessage);
        }

        return json.update.Transaction.value;
    }
}
