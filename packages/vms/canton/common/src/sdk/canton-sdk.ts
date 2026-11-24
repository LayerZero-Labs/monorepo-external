import type { Choice, ContractId, Party, Template } from '@daml/types';

import type { AmuletTransferFactoryArgs } from '../client/amulet';
import type { CantonTransaction, ICantonClient } from '../client/index';
import { CantonProtocolError } from '../errors';
import type {
    ArchivedEvent,
    Command,
    CreatedEvent,
    DisclosedContract,
    JsActiveContract,
} from '../open-api/models';
import type { TransferFactoryContext } from '../refresh/registry-context';
import type { CantonDisclosedContract } from '../transaction';
import type {
    Contract,
    ExternalSignature,
    NormalizedActiveContract,
    PreparedTransaction,
    SubmitActors,
    SubmitResult,
    WaitOptions,
    WaitResult,
} from '../types';

/**
 * High-level SDK for Canton/DAML contract operations.
 *
 * Users interact with this SDK, not CantonClient directly.
 *
 * @example
 * ```ts
 * import { CantonClient, CantonSdk } from '@layerzerolabs/common-canton';
 *
 * const client = new CantonClient(config, userId);
 * const sdk = new CantonSdk(client);
 *
 * await sdk.submit({ actAs: [party] }, [cmd]);
 * ```
 */
export class CantonSdk {
    readonly #client: ICantonClient;

    constructor(client: ICantonClient) {
        this.#client = client;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Validate and extract contract fields from a CreatedEvent.
     * Returns undefined if event is undefined (contract not found).
     */
    #validateContractEvent<T extends object>(
        event: { templateId?: string; contractId?: string; createArgument?: unknown } | undefined,
        contractId: ContractId<T>,
    ): Contract<T> | undefined {
        if (!event) return undefined;

        if (!event.templateId) {
            throw new CantonProtocolError('Contract response missing templateId', {
                contractId,
            });
        }
        if (!event.contractId) {
            throw new CantonProtocolError('Contract response missing contractId', {
                contractId,
            });
        }
        if (event.createArgument === undefined) {
            throw new CantonProtocolError('Contract response missing createArgument', {
                contractId,
            });
        }
        return {
            templateId: event.templateId,
            contractId: event.contractId as ContractId<T>,
            payload: event.createArgument as T,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Command Builders
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Build a create command using a generated DAML template.
     *
     * @param template The generated DAML template (e.g., StateCommitment)
     * @param payload The contract payload
     * @param packageId The package ID from the generated package's index.js
     */
    buildCreate<T extends object, K, I extends string>(
        template: Template<T, K, I>,
        payload: T,
        packageId: string,
    ): Command {
        // Generated templateId format: '#packageName:Module:Entity'
        // Canton API needs: 'packageId:Module:Entity'
        const parts = template.templateId.replace(/^#/, '').split(':');
        parts[0] = packageId;

        return {
            createCommand: {
                templateId: parts.join(':'),
                createArguments: template.encode(payload),
            },
        };
    }

    /**
     * Build an exercise command using a generated DAML choice.
     *
     * @param choice The generated DAML choice (e.g., StateCommitment.Archive)
     * @param contractId The contract ID to exercise on
     * @param args The choice arguments
     * @param packageId The package ID from the generated package's index.js
     */
    buildExercise<T extends object, C, R, K>(
        choice: Choice<T, C, R, K>,
        contractId: ContractId<T>,
        args: C,
        packageId: string,
    ): Command {
        // Generated templateId format: '#packageName:Module:Entity'
        // Canton API needs: 'packageId:Module:Entity'
        const parts = choice.template().templateId.replace(/^#/, '').split(':');
        parts[0] = packageId;

        const encodedArgs = choice.argumentEncode(args);

        return {
            exerciseCommand: {
                templateId: parts.join(':'),
                contractId,
                choice: choice.choiceName,
                choiceArgument: encodedArgs,
            },
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Submission (networked)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Submit commands to the ledger.
     */
    submit(
        actors: SubmitActors,
        commands: Command[],
        opts?: { disclosedContracts?: DisclosedContract[]; commandId?: string },
    ): Promise<SubmitResult> {
        return this.#client.submit(actors, commands, opts);
    }

    /**
     * Prepare commands for off-chain signing by external parties.
     */
    prepareForSigning(
        actors: SubmitActors,
        commands: Command[],
        opts?: { disclosedContracts?: DisclosedContract[]; commandId?: string },
    ): Promise<PreparedTransaction> {
        return this.#client.prepareForSigning(actors, commands, opts);
    }

    /**
     * Submit a pre-signed transaction (external party flow).
     */
    submitSigned(
        prepared: PreparedTransaction,
        signatures: ExternalSignature[],
    ): Promise<SubmitResult> {
        return this.#client.submitSigned(prepared, signatures);
    }

    /**
     * Wait for a command to be accepted or rejected.
     */
    waitForCommand(commandId: string, opts: WaitOptions): Promise<WaitResult> {
        return this.#client.waitForCommand(commandId, opts);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fetch a specific contract by ID.
     * Returns undefined if archived or not visible.
     *
     * @param contractId The contract ID to fetch
     * @param parties Parties to use for visibility filtering
     */
    async get<T extends object>(
        contractId: ContractId<T>,
        parties: Party[],
    ): Promise<Contract<T> | undefined> {
        const event = await this.#client.fetchContractById(contractId, parties);
        return this.#validateContractEvent(event, contractId);
    }

    /**
     * Fetch a live contract's created event by ID, with the views of `interfaceIds` when given:
     * one point lookup that returns the payload, the interface views and the signatories.
     */
    fetchContractEvent(
        contractId: string,
        parties: Party[],
        opts?: { interfaceIds?: string[] },
    ): Promise<CreatedEvent | undefined> {
        return this.#client.fetchContractById(contractId as ContractId<unknown>, parties, opts);
    }

    /**
     * Fetch an update (transaction) by its ID.
     *
     * Use this to get created contract IDs after a command is accepted.
     * The updateId comes from WaitResult.updateId.
     *
     * @param updateId The update ID from WaitResult
     * @param parties Parties to filter events
     * @returns Parsed update with events
     *
     * @example
     * ```ts
     * const waitResult = await sdk.waitForCommand(commandId, opts);
     * if (waitResult.status === 'accepted') {
     *     const tx = await sdk.fetchTransaction(waitResult.updateId, [party]);
     *     const createdIds = (tx.events ?? [])
     *         .filter(e => 'CreatedEvent' in e)
     *         .map(e => e.CreatedEvent.contractId);
     * }
     * ```
     */
    fetchTransaction(updateId: string, parties: string[]): Promise<CantonTransaction> {
        return this.#client.fetchTransactionByUpdateId(updateId, parties);
    }

    /**
     * Fetch a transaction by its offset.
     *
     * @param offset The ledger offset
     * @param parties Parties to filter events
     * @returns Parsed transaction with events and timestamps
     */
    fetchTransactionByOffset(offset: number, parties: string[]): Promise<CantonTransaction> {
        return this.#client.fetchTransactionByOffset(offset, parties);
    }

    /**
     * Fetch both the created and archived events for a contract by ID.
     *
     * @param contractId - The contract ID to look up
     * @param parties - Parties to use for visibility filtering
     */
    fetchEventsByContractId(
        contractId: string,
        parties: string[],
    ): Promise<{ created: CreatedEvent | undefined; archived: ArchivedEvent | undefined }> {
        return this.#client.fetchEventsByContractId(contractId, parties);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Disclosure
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Create a disclosure for a contract.
     *
     * Disclosures allow a party to share a contract's content with another party
     * who isn't a stakeholder, enabling them to exercise choices that reference it.
     *
     * @param contractId The contract to create disclosure for
     * @param parties Parties that have visibility to the contract
     * @returns The disclosed contract, or undefined if contract not found
     *
     * @example
     * ```ts
     * // Alice creates disclosure for Bob to use
     * const disclosure = await aliceSdk.createDisclosure(contractId, [aliceParty]);
     * if (disclosure) {
     *     // Bob uses the disclosure in his submission
     *     await bobSdk.submit(
     *         { actAs: [bobParty] },
     *         [command],
     *         { disclosedContracts: [disclosure] }
     *     );
     * }
     * ```
     */
    createDisclosure<T extends object>(
        contractId: ContractId<T>,
        parties: Party[],
    ): Promise<CantonDisclosedContract | undefined> {
        return this.#client.createDisclosure(contractId, parties);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Amulet wallet
    // ─────────────────────────────────────────────────────────────────────────

    /** DSO party from the validator wallet. Requires a client built with wallet config. */
    getDsoParty(): Promise<string> {
        return this.#client.getDsoParty();
    }

    /** Amulet CIP-56 transfer-factory context from the validator wallet's scan-proxy. */
    getAmuletTransferFactoryContext(
        args: AmuletTransferFactoryArgs,
    ): Promise<TransferFactoryContext> {
        return this.#client.getAmuletTransferFactoryContext(args);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get connected synchronizers.
     */
    connectedSynchronizers(): Promise<string[]> {
        return this.#client.connectedSynchronizers();
    }

    /**
     * Upload a DAR to the participant node.
     *
     * POST /v2/dars
     *
     * @param opts.skipIfVetted - If true, treat KNOWN_PACKAGE_VERSION errors as success
     */
    uploadDar(
        dar: Uint8Array<ArrayBuffer>,
        opts?: { vetAllPackages?: boolean; synchronizerId?: string; skipIfVetted?: boolean },
    ): Promise<object> {
        return this.#client.uploadDar(dar, opts);
    }

    /**
     * Validate a DAR for upgrade compatibility against the current vetting state.
     *
     * POST /v2/dars/validate
     */
    validateDar(dar: Uint8Array<ArrayBuffer>, opts?: { synchronizerId?: string }): Promise<void> {
        return this.#client.validateDar(dar, opts);
    }

    /**
     * List all known parties on the participant node.
     *
     * GET /v2/parties
     *
     * @param opts.pageSize - Maximum number of results per page
     * @param opts.pageToken - Pagination token from previous response
     * @returns Array of party IDs
     */
    listParties(opts?: {
        pageSize?: number;
        pageToken?: string;
    }): Promise<{ parties: string[]; nextPageToken?: string }> {
        return this.#client.listParties(opts);
    }

    /**
     * List the parties the configured user can act/read as.
     *
     * Narrower than {@link listParties} (all parties on the node): use this when a
     * call needs the caller's own read-scoped parties.
     */
    listUserParties(): Promise<string[]> {
        return this.#client.listUserParties();
    }

    /**
     * Allocate a new party on the participant node.
     *
     * POST /v2/parties
     *
     * @param partyIdHint - A hint for the party ID (e.g., "alice", "bob")
     * @param opts.userId - User who gets actAs rights (empty string = no user)
     * @param opts.synchronizerId - Synchronizer to allocate on (auto-detected if omitted)
     * @param opts.identityProviderId - Identity provider ID (empty string = default)
     * @returns The allocated party ID
     */
    allocateParty(
        partyIdHint: string,
        opts?: { userId?: string; synchronizerId?: string; identityProviderId?: string },
    ): Promise<string> {
        return this.#client.allocateParty(partyIdHint, opts);
    }

    /**
     * Get the package ID for a package by name.
     *
     * POST /v2/interactive-submission/preferred-packages
     *
     * @param packageName - The package name (e.g., "layerzero-oft")
     * @param parties - Parties whose vetting state should be considered
     * @param opts.synchronizerId - Synchronizer to query (auto-detected if omitted)
     * @returns The package ID (hash)
     */
    getPackageId(
        packageName: string,
        parties: string[],
        opts?: { synchronizerId?: string },
    ): Promise<string> {
        return this.#client.getPackageId(packageName, parties, opts);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Active Contracts Query
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get the current ledger end offset.
     *
     * GET /v2/state/ledger-end
     *
     * @returns The current ledger end offset
     */
    getLedgerEndOffset(): Promise<number> {
        return this.#client.getLedgerEndOffset();
    }

    /**
     * Query active contracts at a given offset with optional template filtering.
     *
     * POST /v2/state/active-contracts
     *
     * @param party - Party to query as (for visibility)
     * @param offset - Ledger offset to query at
     * @param opts.templateIds - Template IDs to filter by (e.g., "packageId:Module:Template")
     * @param opts.limit - Maximum number of contracts to return
     * @returns Array of active contracts
     *
     * @example
     * ```ts
     * const offset = await sdk.getLedgerEndOffset();
     * const contracts = await sdk.queryActiveContracts(party, offset, {
     *     templateIds: ['packageId:SimpleRequest:SimpleRequest'],
     *     limit: 100,
     * });
     * for (const contract of contracts) {
     *     console.log(contract.createdEvent.contractId, contract.createdEvent.templateId);
     * }
     * ```
     */
    queryActiveContracts(
        party: string,
        offset: number,
        opts?: { templateIds?: string[]; limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]> {
        return this.#client.queryActiveContracts(party, offset, opts);
    }

    /**
     * Normalize a ledger API JsActiveContract to a flat shape (contractId, templateId, payload, synchronizerId).
     * Useful when you only need these fields and not createdEvent / reassignmentCounter.
     */
    static normalizeActiveContract(contract: JsActiveContract): NormalizedActiveContract {
        const e = contract.createdEvent;
        return {
            contractId: e.contractId,
            templateId: e.templateId,
            payload: e.createArgument,
            synchronizerId: contract.synchronizerId,
        };
    }

    /**
     * Query active contracts visible to any of the given parties (single API call).
     */
    queryActiveContractsByParties(
        parties: string[],
        offset: number,
        templateIds: string[],
        opts?: { limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]> {
        return this.#client.queryActiveContractsByParties(parties, offset, templateIds, opts);
    }

    /**
     * Query active contracts visible to any of the given parties that implement
     * the given interfaces (single API call).
     */
    queryActiveContractsByInterface(
        parties: string[],
        offset: number,
        interfaceIds: string[],
        opts?: { limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]> {
        return this.#client.queryActiveContractsByInterface(parties, offset, interfaceIds, opts);
    }

    /**
     * Query active contracts visible to any of the given parties, deduplicated by contractId.
     * Returns normalized contracts (flat shape). Use when you need a merged view across multiple parties.
     *
     * @param parties - Party IDs to query as (contracts visible to any party are included, each contract once)
     * @param opts - Optional templateIds and limit (passed per-party to the ledger API); optional templateFilter (applied after fetch)
     */
    async queryActiveContractsForParties(
        parties: string[],
        opts?: {
            templateIds?: string[];
            limit?: number;
            /** If provided, only contracts whose templateId passes this predicate are returned. */
            templateFilter?: (templateId: string) => boolean;
        },
    ): Promise<NormalizedActiveContract[]> {
        const offset = await this.#client.getLedgerEndOffset();
        const { templateFilter, ...apiOpts } = opts ?? {};
        const perPartyResults = await Promise.all(
            parties.map((partyId) => this.#client.queryActiveContracts(partyId, offset, apiOpts)),
        );
        const seen = new Set<string>();
        const result: NormalizedActiveContract[] = [];
        for (const contracts of perPartyResults) {
            for (const c of contracts) {
                const cid = c.createdEvent.contractId;
                if (!seen.has(cid)) {
                    seen.add(cid);
                    const normalized = CantonSdk.normalizeActiveContract(c);
                    if (!templateFilter || templateFilter(normalized.templateId)) {
                        result.push(normalized);
                    }
                }
            }
        }
        return result;
    }
}
