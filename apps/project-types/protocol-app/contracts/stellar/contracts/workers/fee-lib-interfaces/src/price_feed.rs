use soroban_sdk::{contractclient, contracttype, Address, Env};

// ================================================
// Price Feed Types
// ================================================

/// Gas price information for a destination endpoint.
///
/// Contains the exchange rate and gas costs needed for cross-chain fee calculations.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Price {
    /// Price ratio = (remote native token price / local native token price) * PRICE_RATIO_DENOMINATOR.
    /// Used to convert destination chain gas costs to source chain native token.
    pub price_ratio: u128,
    /// Gas price in the smallest unit (wei for EVM, stroops for Stellar).
    pub gas_price_in_unit: u64,
    /// Gas cost per byte of calldata on the destination chain.
    pub gas_per_byte: u32,
}

/// Fee estimation result with detailed breakdown.
///
/// Contains the calculated fee and all intermediate values used in the calculation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeEstimate {
    /// Total gas fee in source chain native token units.
    pub total_gas_fee: i128,
    /// Price ratio used for the calculation.
    pub price_ratio: u128,
    /// Denominator for the price ratio (typically 10^20).
    pub price_ratio_denominator: u128,
    /// Source chain native token price in USD (scaled).
    pub native_price_usd: u128,
}

// ================================================
// ILayerZeroPriceFeed Trait
// ================================================

/// Price feed interface for cross-chain fee calculations.
///
/// Provides gas prices, exchange rates, and fee estimation for destination chains.
/// Called by ExecutorFeeLib to calculate execution fees. The price feed aggregates
/// data from multiple sources to provide accurate cross-chain pricing information.
#[contractclient(name = "LayerZeroPriceFeedClient")]
pub trait ILayerZeroPriceFeed {
    /// Returns the USD price of the source chain native token.
    ///
    /// # Returns
    /// Native token price in USD (scaled by appropriate denominator).
    fn native_token_price_usd(env: &Env) -> u128;

    /// Returns gas price information for a destination endpoint.
    ///
    /// # Arguments
    /// * `dst_eid` - Destination endpoint ID (chain identifier)
    ///
    /// # Returns
    /// `Some(Price)` containing price_ratio, gas_price_in_unit, and gas_per_byte, or `None` if not set.
    fn get_price(env: &Env, dst_eid: u32) -> Option<Price>;

    /// Returns the denominator used for price ratio calculations.
    ///
    /// # Returns
    /// Price ratio denominator (typically 10^20 for precision).
    fn get_price_ratio_denominator(env: &Env) -> u128;

    /// Estimates the fee for executing on a destination chain.
    ///
    /// This is the primary function called by ExecutorFeeLib for fee calculations.
    /// It combines gas costs, calldata costs, and exchange rates to estimate the
    /// total fee in source chain native token.
    ///
    /// # Arguments
    /// * `fee_lib` - The fee library contract address (for caller identification)
    /// * `dst_eid` - Destination endpoint ID (chain identifier)
    /// * `calldata_size` - Size of the message calldata in bytes
    /// * `gas` - Gas amount needed for execution on destination
    ///
    /// # Returns
    /// `FeeEstimate` with total_gas_fee, price_ratio, price_ratio_denominator, and native_price_usd.
    fn estimate_fee_by_eid(env: &Env, fee_lib: &Address, dst_eid: u32, calldata_size: u32, gas: u128) -> FeeEstimate;
}
