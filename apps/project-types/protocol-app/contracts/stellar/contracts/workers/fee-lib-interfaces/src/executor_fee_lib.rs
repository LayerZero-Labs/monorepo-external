use soroban_sdk::{contractclient, contracttype, Address, Bytes, Env};

// ============================================================================
// Fee Calculation Types
// ============================================================================

/// Parameters for executor fee calculation.
///
/// Contains all inputs needed by the fee library to calculate execution fees
/// for cross-chain messages. Includes message parameters, common configuration,
/// and destination-specific settings.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeParams {
    /// ============================================================================================
    /// Message Parameters
    /// ============================================================================================

    /// The OApp sender address.
    pub sender: Address,
    /// Destination endpoint ID (chain identifier).
    pub dst_eid: u32,
    /// Size of the message calldata in bytes.
    pub calldata_size: u32,
    /// Encoded executor options (lzReceive gas, lzCompose, nativeDrop, etc.).
    pub options: Bytes,

    /// ============================================================================================
    /// Common Configuration
    /// ============================================================================================

    /// Price feed contract address for gas price and exchange rate data.
    pub price_feed: Address,
    /// Default fee multiplier in basis points (used if no dst-specific multiplier).
    pub default_multiplier_bps: u32,

    /// ============================================================================================
    /// Destination-Specific Configuration
    /// ============================================================================================

    /// Base gas for lzReceive execution on destination chain.
    pub lz_receive_base_gas: u64,
    /// Base gas for each lzCompose call on destination chain.
    pub lz_compose_base_gas: u64,
    /// Minimum fee margin in USD (scaled).
    pub floor_margin_usd: u128,
    /// Maximum native token value that can be sent.
    pub native_cap: u128,
    /// Destination-specific fee multiplier in basis points (0 = use default).
    pub multiplier_bps: u32,
}

// ============================================================================
// IExecutorFeeLib Trait
// ============================================================================

/// Interface for executor fee calculation.
///
/// Called by the Executor contract to calculate fees for message execution.
/// Uses the PriceFeed interface to obtain gas prices and exchange rates.
#[contractclient(name = "ExecutorFeeLibClient")]
pub trait IExecutorFeeLib {
    /// Calculates the executor fee for a cross-chain message.
    ///
    /// The fee calculation considers:
    /// - Gas costs for lzReceive and lzCompose operations
    /// - Native token value transfers
    /// - Price ratios between source and destination chains
    /// - Configured multipliers and floor margins
    ///
    /// # Arguments
    /// * `executor` - The executor contract address
    /// * `params` - Fee calculation parameters
    ///
    /// # Returns
    /// The calculated fee in native token units (stroops for Stellar).
    fn get_fee(env: &Env, executor: &Address, params: &FeeParams) -> i128;

    /// Returns the fee library contract version.
    ///
    /// # Returns
    /// Tuple of (major version, minor version).
    fn version(env: &Env) -> (u64, u32);
}
