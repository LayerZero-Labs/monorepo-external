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

/**
 * The input `generateConfigChangeTransactions` needs to encode a config change
 * (setSigner / setThreshold / setSeed / ...) into one transaction per chain.
 *
 * Callers used to pass the whole flat `OneSigConfig`, but the encoder only ever
 * reads the per-chain OneSig contract addresses — the change values themselves are
 * supplied separately as operation params. This purpose-built type captures just
 * that, so the encoder no longer depends on the deprecated `OneSigConfig`, and
 * callers pass only the chains a given change should apply to (e.g. a single
 * partition's chains when editing a partitioned OneSig).
 */
export interface OneSigConfigChangeInput {
    /** Map of chain name to that chain's OneSig contract address. */
    contractAddresses: Record<string, string>;
}
