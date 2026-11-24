import type { ContractId } from '@daml/types';

import type {
    ArchivedEvent,
    Command,
    CreatedEvent,
    DisclosedContract,
    ExercisedEvent,
    JsActiveContract,
    JsTransaction,
    OffsetCheckpoint,
    Reassignment,
    TopologyTransaction,
} from '../open-api/models';
import type { TransferFactoryContext } from '../refresh/registry-context';
import type { CantonDisclosedContract } from '../transaction';
import type {
    ExternalSignature,
    PreparedTransaction,
    PreparedTransactionWithExpiry,
    SubmitActors,
    SubmitResult,
    UserRight,
    WaitOptions,
    WaitResult,
    WaitWithExpiryResult,
} from '../types';
import type {
    AmuletContextOptions,
    AmuletContextResult,
    AmuletTransferFactoryArgs,
    InstrumentId,
    TransferInstructionAcceptContextResult,
    TransferInstructionChoice,
} from './amulet';

// ─────────────────────────────────────────────────────────────────────────────
// Corrected Update Types
// ─────────────────────────────────────────────────────────────────────────────
// The OpenAPI generated types use camelCase keys but the Canton JSON API returns PascalCase.
// These types reflect the actual API response structure.

/**
 * Event union with PascalCase keys matching the actual Canton JSON API response.
 */
export type CantonEvent =
    | { CreatedEvent: CreatedEvent }
    | { ArchivedEvent: ArchivedEvent }
    | { ExercisedEvent: ExercisedEvent };

/**
 * Transaction type with correctly-cased event types.
 */
export type CantonTransaction = Omit<JsTransaction, 'events'> & {
    events?: CantonEvent[];
};

/**
 * Update union with PascalCase keys matching the actual Canton JSON API response.
 * Covers all update types: Transaction, Reassignment, TopologyTransaction, OffsetCheckpoint.
 */
export type CantonUpdate =
    | { Transaction: { value: CantonTransaction } }
    | { Reassignment: Reassignment }
    | { TopologyTransaction: TopologyTransaction }
    | { OffsetCheckpoint: OffsetCheckpoint };

/**
 * Response wrapper for a single update (from fetchTransactionByUpdateId/fetchTransactionByOffset).
 */
export type CantonUpdateResponse = {
    update: CantonUpdate;
};

/**
 * Interface for CantonClient - the low-level transport layer.
 *
 * Implement this interface to create custom clients (e.g., for testing).
 */
export interface ICantonClient {
    /**
     * Returns all connected synchronizer IDs.
     */
    connectedSynchronizers(): Promise<string[]>;

    getDsoParty(): Promise<string>;

    getAmuletTransferFactoryContext(
        args: AmuletTransferFactoryArgs,
    ): Promise<TransferFactoryContext>;

    /**
     * Returns the local participant's unique identifier.
     *
     * GET /v2/parties/participant-id
     */
    getLocalParticipantId(): Promise<string>;

    /** Amulet ChoiceContext with ExternalPartyAmuletRules injected — requires wallet config. */
    getAmuletContextWithExternalRules(
        instrumentId: InstrumentId,
        options?: AmuletContextOptions,
    ): Promise<AmuletContextResult>;

    getTransferInstructionContext(args: {
        contractId: string;
        choice: TransferInstructionChoice;
    }): Promise<TransferInstructionAcceptContextResult>;

    getTransferInstructionAcceptContext(args: {
        contractId: string;
    }): Promise<TransferInstructionAcceptContextResult>;

    /**
     * Submit a batch of commands atomically.
     */
    submit(
        actors: SubmitActors,
        commands: Command[],
        opts?: { disclosedContracts?: DisclosedContract[]; commandId?: string },
    ): Promise<SubmitResult>;

    /**
     * Wait for a command to be accepted or rejected.
     */
    waitForCommand(commandId: string, opts: WaitOptions): Promise<WaitResult>;

    waitForCommandWithExpiry(
        commandId: string,
        opts: Omit<WaitOptions, 'beginExclusive'> & {
            expiry: PreparedTransactionWithExpiry['expiry'];
        },
    ): Promise<WaitWithExpiryResult>;

    /**
     * Build a disclosure for a contract.
     * @param contractId - The contract ID to create disclosure for
     * @param parties - Parties that have visibility to the contract
     */
    createDisclosure(
        contractId: ContractId<unknown>,
        parties: string[],
    ): Promise<CantonDisclosedContract | undefined>;

    /**
     * Fetch a single contract by ID. With `interfaceIds`, the event carries those interface views.
     */
    fetchContractById(
        contractId: ContractId<unknown>,
        parties: string[],
        opts?: { interfaceIds?: string[] },
    ): Promise<CreatedEvent | undefined>;

    /**
     * Fetch both the created and archived events for a contract by ID.
     * Unlike fetchContractById, this preserves archival information.
     *
     * Accepts plain string (not ContractId<unknown>) because callers in the
     * chain layer work with raw contract IDs that aren't branded.
     */
    fetchEventsByContractId(
        contractId: string,
        parties: string[],
    ): Promise<{ created: CreatedEvent | undefined; archived: ArchivedEvent | undefined }>;

    /**
     * Fetch a transaction by its update ID.
     */
    fetchTransactionByUpdateId(updateId: string, parties: string[]): Promise<CantonTransaction>;

    /**
     * Fetch a transaction by its offset.
     *
     * @param offset - The ledger offset
     * @param parties - Parties to use for the query filter
     * @returns The full transaction including recordTime (ISO timestamp)
     */
    fetchTransactionByOffset(offset: number, parties: string[]): Promise<CantonTransaction>;

    /**
     * Prepare commands for external party signing.
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

    /**
     * Submit a pre-signed transaction.
     */
    submitSigned(
        prepared: PreparedTransaction | PreparedTransactionWithExpiry,
        signatures: ExternalSignature[],
    ): Promise<SubmitResult>;

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
    ): Promise<object>;

    /**
     * Validate a DAR for upgrade compatibility against the current vetting state.
     *
     * POST /v2/dars/validate
     */
    validateDar(dar: Uint8Array<ArrayBuffer>, opts?: { synchronizerId?: string }): Promise<void>;

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
    }): Promise<{ parties: string[]; nextPageToken?: string }>;

    /**
     * Return the rights granted to the current user (this user's userId in
     * the underlying token).
     *
     * GET /v2/users/{userId}/rights
     */
    listUserRights(): Promise<UserRight[]>;

    /**
     * Convenience wrapper over `listUserRights()` returning just the parties
     * the current user has CanActAs / CanReadAs rights for. Use instead of
     * `listParties()` when the call requires scoped read access (Canton
     * returns 403 if you query as a party you can't read).
     */
    listUserParties(): Promise<string[]>;

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
    ): Promise<string>;

    /**
     * Generate unsigned topology transactions for an external party.
     *
     * POST /v2/parties/external/generate-topology
     *
     * Returns the deterministic partyId derived from partyHint + publicKey, plus
     * a multiHash (base64) covering all generated transactions that the external party
     * owner must sign before calling allocateExternalParty.
     */
    generateExternalPartyTopology(args: {
        partyHint: string;
        publicKey: { format: string; keyData: string; keySpec: string };
        localParticipantObservationOnly: boolean;
        confirmationThreshold: number;
    }): Promise<{
        partyId: string;
        topologyTransactions: string[];
        multiHash: string;
        synchronizerId: string;
    }>;

    /**
     * Submit signed topology transactions to register an external party.
     *
     * POST /v2/parties/external/allocate
     *
     * @param args.synchronizerId - Target synchronizer
     * @param args.topologyTransactions - Unsigned transactions from generateExternalPartyTopology
     * @param args.multiHashSignatures - Signatures over the multiHash from generateExternalPartyTopology
     * @returns The allocated party ID
     */
    allocateExternalParty(args: {
        synchronizerId: string;
        topologyTransactions: string[];
        multiHashSignatures: Array<{
            format: string;
            signature: string;
            signedBy: string;
            signingAlgorithmSpec: string;
        }>;
    }): Promise<string>;

    /**
     * Grant canActAs right for a party to the current service user.
     * Idempotent — safe to call even if the right is already granted.
     *
     * POST /v2/users/{userId}/rights
     */
    grantCanActAs(partyId: string): Promise<void>;

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
    ): Promise<string>;

    /**
     * Get the current ledger end offset.
     *
     * GET /v2/state/ledger-end
     *
     * @returns The current ledger end offset
     */
    getLedgerEndOffset(): Promise<number>;

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
     */
    queryActiveContracts(
        party: string,
        offset: number,
        opts?: { templateIds?: string[]; limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]>;

    /**
     * Query active contracts visible to any of the given parties (single API call).
     *
     * @param parties - Parties to query as (for visibility)
     * @param offset - Ledger offset to query at
     * @param templateIds - Template IDs to filter by
     * @param opts.limit - Maximum number of contracts to return
     * @returns Array of active contracts
     */
    queryActiveContractsByParties(
        parties: string[],
        offset: number,
        templateIds: string[],
        opts?: { limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]>;

    /**
     * Query active contracts visible to any of the given parties that implement
     * the given interfaces.
     *
     * @param parties - Parties to query as (for visibility)
     * @param offset - Ledger offset to query at
     * @param interfaceIds - Interface IDs to filter by (e.g., "#package:Module:Interface")
     * @param opts.limit - Maximum number of contracts to return
     */
    queryActiveContractsByInterface(
        parties: string[],
        offset: number,
        interfaceIds: string[],
        opts?: { limit?: number; includeCreatedEventBlob?: boolean },
    ): Promise<JsActiveContract[]>;

    /**
     * Stream updates from a given offset.
     *
     * POST /v2/updates
     *
     * @param party - Party to query as (for visibility)
     * @param beginExclusive - Start offset (exclusive)
     * @param endInclusive - End offset (inclusive)
     * @param opts.templateIds - Template IDs to filter by
     * @param opts.limit - Maximum number of updates to return
     * @returns Array of all update types (Transaction, Reassignment, TopologyTransaction, OffsetCheckpoint)
     */
    getUpdates(
        party: string,
        beginExclusive: number,
        endInclusive: number,
        opts?: { templateIds?: string[]; limit?: number },
    ): Promise<CantonUpdate[]>;
}
