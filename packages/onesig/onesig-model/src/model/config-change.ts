/**
 * Normalized shape for a config-change call that any chain encoder produces.
 *
 * Mirrors the `OneSigCallInput` contract used by downstream leaf/bundle
 * shapers so it can be dropped straight into a `StagingTransaction`.
 */
export interface OneSigConfigChangeCall {
    /** Chain name this call targets (e.g. "ethereum", "solana-mainnet") */
    chainName: string;
    /** Target address (contract / program) */
    to: string;
    /** Native value to send (stringified, e.g. "0") */
    value: string;
    /** Encoded calldata — format is chain-specific */
    data: string;
    /** Chain-specific metadata consumed by downstream shapers (e.g. Solana keys, Starknet selector) */
    metadata?: Record<string, unknown>;
}

/** The config-change operations supported across all chain types. */
export type ConfigChangeOperation =
    | 'setSigner'
    | 'removeSigner'
    | 'setThreshold'
    | 'setSeed'
    | 'setExecutor'
    | 'removeExecutor';
