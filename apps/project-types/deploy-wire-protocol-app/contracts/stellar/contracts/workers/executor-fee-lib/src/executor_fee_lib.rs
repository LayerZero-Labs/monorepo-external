use crate::{errors::ExecutorFeeLibError, executor_option};
use common_macros::{contract_impl, lz_contract};
use fee_lib_interfaces::{FeeParams, IExecutorFeeLib, LayerZeroPriceFeedClient};
use soroban_sdk::{assert_with_error, Address, Bytes, Env};

// ============================================================================
// Constants
// ============================================================================

/// V1 endpoint ID threshold. EIDs below this are V1 endpoints with restrictions.
const V1_EID_THRESHOLD: u32 = 30000;

/// Basis points denominator (10000 = 100%).
const BPS_DENOMINATOR: u128 = 10000;

/// Overhead percentage for ordered execution (102 = 2% overhead).
const ORDERED_EXECUTION_OVERHEAD_PERCENT: u128 = 102;

/// Native token decimal rate for XLM (10^7 stroops per XLM).
const NATIVE_DECIMALS_RATE: u128 = 10_000_000;

/// ExecutorFeeLib contract for calculating executor fees.
///
/// Provides fee calculation logic based on executor options, destination configuration,
/// and current gas prices from the price feed. Handles fee multipliers, margins, and
/// native token value conversions.
#[lz_contract(upgradeable(no_migration))]
pub struct ExecutorFeeLib;

#[contract_impl]
impl ExecutorFeeLib {
    pub fn __constructor(env: &Env, owner: &Address) {
        Self::init_owner(env, owner);
    }
}

// ============================================================================
// IExecutorFeeLib Implementation
// ============================================================================

#[contract_impl]
impl IExecutorFeeLib for ExecutorFeeLib {
    /// Calculates the total execution fee for a cross-chain message.
    ///
    /// Decodes executor options, estimates gas fees from the price feed, applies
    /// multipliers and margins, and converts native token values. Returns the
    /// total fee in native tokens.
    ///
    /// # Arguments
    /// * `executor` - Executor contract address (unused, kept for interface compatibility)
    /// * `params` - Fee calculation parameters
    ///
    /// # Returns
    /// Total execution fee in native tokens.
    ///
    /// # Errors
    /// * `EidNotSupported` - If destination endpoint is not supported (lz_receive_base_gas is 0)
    /// * Various executor option parsing errors (see `parse_executor_options`)
    fn get_fee(env: &Env, _executor: &Address, params: &FeeParams) -> i128 {
        assert_with_error!(env, params.lz_receive_base_gas != 0, ExecutorFeeLibError::EidNotSupported);

        let (total_value, total_gas) = decode_executor_options(
            env,
            &params.options,
            params.dst_eid,
            params.lz_receive_base_gas,
            params.lz_compose_base_gas,
            params.native_cap,
        );

        let fee_estimate = LayerZeroPriceFeedClient::new(env, &params.price_feed).estimate_fee_by_eid(
            &env.current_contract_address(),
            &params.dst_eid,
            &params.calldata_size,
            &total_gas,
        );

        let multiplier_bps = get_effective_multiplier_bps(params);

        let mut fee = apply_premium_to_gas(
            env,
            fee_estimate.total_gas_fee,
            multiplier_bps,
            params.floor_margin_usd,
            fee_estimate.native_price_usd,
        );

        fee += convert_and_apply_premium_to_value(
            env,
            total_value,
            fee_estimate.price_ratio,
            fee_estimate.price_ratio_denominator,
            multiplier_bps,
        );

        fee
    }

    /// Returns the version of the fee library.
    ///
    /// # Returns
    /// Tuple of (major_version, minor_version).
    fn version(_env: &Env) -> (u64, u32) {
        (1, 1)
    }
}

// ========================================================================
// Helper Functions
// ========================================================================

/// Decodes executor options and calculates total gas and native value.
///
/// Parses encoded executor options, accumulates gas requirements (including
/// compose calls and ordered execution overhead), and returns the total native
/// value and gas needed.
///
/// # Arguments
/// * `options` - Encoded executor options bytes
/// * `dst_eid` - Destination endpoint ID
/// * `lz_receive_base_gas` - Base gas for lzReceive execution
/// * `lz_compose_base_gas` - Base gas per lzCompose call
/// * `native_cap` - Maximum allowed native token value
///
/// # Returns
/// Tuple of (total_native_value, total_gas).
fn decode_executor_options(
    env: &Env,
    options: &Bytes,
    dst_eid: u32,
    lz_receive_base_gas: u64,
    lz_compose_base_gas: u64,
    native_cap: u128,
) -> (u128, u128) {
    let options_agg = executor_option::parse_executor_options(env, options, is_v1_eid(dst_eid), native_cap);

    let mut total_gas = (lz_receive_base_gas as u128)
        + options_agg.total_gas
        + ((lz_compose_base_gas as u128) * (options_agg.num_lz_compose as u128));

    if options_agg.ordered {
        total_gas = (total_gas * ORDERED_EXECUTION_OVERHEAD_PERCENT) / 100;
    }

    (options_agg.total_value, total_gas)
}

/// Returns the effective multiplier in basis points.
///
/// Uses destination-specific multiplier if set, otherwise falls back to default multiplier.
///
/// # Arguments
/// * `params` - Fee parameters containing multiplier settings
///
/// # Returns
/// Effective multiplier in basis points.
fn get_effective_multiplier_bps(params: &FeeParams) -> u32 {
    if params.multiplier_bps == 0 {
        params.default_multiplier_bps
    } else {
        params.multiplier_bps
    }
}

/// Applies premium (multiplier and margin) to gas fee.
///
/// Calculates fee with multiplier and floor margin, returning the maximum of both
/// to ensure profitability.
///
/// # Arguments
/// * `fee` - Base gas fee
/// * `multiplier_bps` - Fee multiplier in basis points
/// * `margin_usd` - Minimum margin in USD (scaled)
/// * `native_price_usd` - Native token price in USD (scaled)
///
/// # Example(scaled to 10^20)
/// With margin_usd = $0.01 (0.01 * 10^20), native_price_usd = $0.32 (0.32 * 10^20), fee = 0:
/// fee_with_margin = ((0.01 * 10^20 * 10^7) / (0.32 * 10^20)) + 0 = 312_500 stroops (0.03125 XLM)
///
/// # Returns
/// Fee with premium applied (max of multiplier fee and margin fee).
fn apply_premium_to_gas(env: &Env, fee: i128, multiplier_bps: u32, margin_usd: u128, native_price_usd: u128) -> i128 {
    assert_with_error!(env, fee >= 0, ExecutorFeeLibError::InvalidFee);

    let fee_with_multiplier = safe_u128_to_i128(env, (fee as u128 * multiplier_bps as u128) / BPS_DENOMINATOR);

    if native_price_usd == 0 || margin_usd == 0 {
        return fee_with_multiplier;
    }

    let margin_in_native = (margin_usd * NATIVE_DECIMALS_RATE) / native_price_usd;
    let fee_with_margin = safe_u128_to_i128(env, margin_in_native) + fee;

    fee_with_margin.max(fee_with_multiplier)
}

/// Converts native value and applies premium multiplier.
///
/// Converts value using price ratio and applies multiplier in basis points.
///
/// # Arguments
/// * `value` - Native value to convert
/// * `ratio` - Price ratio numerator
/// * `denom` - Price ratio denominator
/// * `multiplier_bps` - Fee multiplier in basis points
///
/// # Returns
/// Converted and multiplied value, or 0 if input value is 0.
fn convert_and_apply_premium_to_value(env: &Env, value: u128, ratio: u128, denom: u128, multiplier_bps: u32) -> i128 {
    if value == 0 {
        return 0;
    }
    let converted = (value * ratio) / denom;
    safe_u128_to_i128(env, (converted * multiplier_bps as u128) / BPS_DENOMINATOR)
}

/// Checks if an endpoint ID is a V1 endpoint.
///
/// V1 endpoints (EID < 30000) have restrictions on executor options.
///
/// # Arguments
/// * `eid` - Endpoint ID to check
///
/// # Returns
/// `true` if the endpoint is a V1 endpoint, `false` otherwise.
fn is_v1_eid(eid: u32) -> bool {
    eid < V1_EID_THRESHOLD
}

/// Safely converts u128 to i128, panicking if value exceeds i128::MAX.
fn safe_u128_to_i128(env: &Env, value: u128) -> i128 {
    assert_with_error!(env, value <= i128::MAX as u128, ExecutorFeeLibError::Overflow);
    value as i128
}

// ============================================================================
// Test-only Functions
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;

    impl ExecutorFeeLib {
        /// Test-only wrapper for `decode_executor_options` to enable unit testing.
        pub fn decode_executor_options_for_test(
            env: &Env,
            options: &Bytes,
            dst_eid: u32,
            lz_receive_base_gas: u64,
            lz_compose_base_gas: u64,
            native_cap: u128,
        ) -> (u128, u128) {
            super::decode_executor_options(env, options, dst_eid, lz_receive_base_gas, lz_compose_base_gas, native_cap)
        }

        /// Test-only wrapper for `get_effective_multiplier_bps`.
        pub fn get_effective_multiplier_bps_for_test(_env: &Env, params: &FeeParams) -> u32 {
            super::get_effective_multiplier_bps(params)
        }

        /// Test-only wrapper for `apply_premium_to_gas`.
        pub fn apply_premium_to_gas_for_test(
            env: &Env,
            fee: i128,
            multiplier_bps: u32,
            margin_usd: u128,
            native_price_usd: u128,
        ) -> i128 {
            super::apply_premium_to_gas(env, fee, multiplier_bps, margin_usd, native_price_usd)
        }

        /// Test-only wrapper for `convert_and_apply_premium_to_value`.
        pub fn convert_and_apply_premium_to_value_for_test(
            env: &Env,
            value: u128,
            ratio: u128,
            denom: u128,
            multiplier_bps: u32,
        ) -> i128 {
            super::convert_and_apply_premium_to_value(env, value, ratio, denom, multiplier_bps)
        }

        /// Test-only wrapper for `is_v1_eid`.
        pub fn is_v1_eid_for_test(_env: &Env, eid: u32) -> bool {
            super::is_v1_eid(eid)
        }

        /// Test-only wrapper for `safe_u128_to_i128`.
        pub fn safe_u128_to_i128_for_test(env: &Env, value: u128) -> i128 {
            super::safe_u128_to_i128(env, value)
        }
    }
}
