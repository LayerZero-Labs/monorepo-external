use soroban_sdk::{contractclient, contracttype, Address, Bytes, Env};

// ============================================================================
// Fee Calculation Types
// ============================================================================

/// Parameters for DVN fee calculation.
///
/// Contains all inputs needed by the fee library to calculate verification fees
/// for cross-chain messages. Includes message parameters, common configuration,
/// and destination-specific settings.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DvnFeeParams {
    /// ============================================================================================
    /// Message Parameters
    /// ============================================================================================

    /// The OApp sender address.
    pub sender: Address,
    /// Destination endpoint ID (chain identifier).
    pub dst_eid: u32,
    /// Number of block confirmations required.
    pub confirmations: u64,
    /// DVN options
    pub options: Bytes,

    /// ============================================================================================
    /// Common Configuration
    /// ============================================================================================

    /// Price feed contract address for gas price and exchange rate data.
    pub price_feed: Address,
    /// Default fee multiplier in basis points (used if no dst-specific multiplier).
    pub default_multiplier_bps: u32,
    /// Number of required signatures (quorum).
    pub quorum: u32,

    /// ============================================================================================
    /// Destination-Specific Configuration
    /// ============================================================================================

    /// Gas estimate for verification on destination chain.
    pub gas: u128,
    /// Destination-specific fee multiplier in basis points (0 = use default).
    pub multiplier_bps: u32,
    /// Minimum fee margin in USD (scaled).
    pub floor_margin_usd: u128,
}

// ============================================================================
// IDvnFeeLib Trait
// ============================================================================

/// Interface for DVN fee calculation.
///
/// Called by the DVN contract to calculate fees for verification jobs.
/// Uses the PriceFeed interface to obtain gas prices and exchange rates.
#[contractclient(name = "DvnFeeLibClient")]
pub trait IDvnFeeLib {
    /// Calculates the DVN fee for a verification job.
    ///
    /// The fee calculation considers:
    /// - Gas costs for verification on destination chain
    /// - Quorum size (number of required signatures)
    /// - Configured multipliers and floor margins
    /// - Price ratios between source and destination chains
    ///
    /// # Arguments
    /// * `dvn` - The DVN contract address
    /// * `params` - Fee calculation parameters
    ///
    /// # Returns
    /// The calculated fee in native token units (stroops for Stellar).
    fn get_fee(env: &Env, dvn: &Address, params: &DvnFeeParams) -> i128;

    /// Returns the fee library contract version.
    ///
    /// # Returns
    /// Tuple of (major version, minor version).
    fn version(env: &Env) -> (u64, u32);
}
