use crate::errors::DvnFeeLibError;
use common_macros::{contract_impl, lz_contract};
use fee_lib_interfaces::{DvnFeeParams, IDvnFeeLib, LayerZeroPriceFeedClient};
use soroban_sdk::{assert_with_error, Address, Env};

// ============================================================================
// Constants
// ============================================================================

/// Basis points denominator (10000 = 100%).
const BPS_BASE: i128 = 10000;

/// Fixed bytes for execute function call.
const EXECUTE_FIXED_BYTES: u32 = 260;

/// Raw signature bytes length (65 bytes: 64 for signature + 1 for recovery ID).
const SIGNATURE_RAW_BYTES: u32 = 65;

/// Verify function bytes (padded).
const VERIFY_BYTES: u32 = 288;

/// Native token decimal rate for XLM (10^7 stroops per XLM).
const NATIVE_DECIMALS_RATE: u128 = 10_000_000;

/// DVN fee library contract for calculating DVN verification fees.
///
/// Provides fee calculation logic based on quorum size, destination gas costs,
/// and current gas prices from the price feed. Handles fee multipliers and
/// floor margins.
#[lz_contract(upgradeable(no_migration))]
pub struct DvnFeeLib;

#[contract_impl]
impl DvnFeeLib {
    pub fn __constructor(env: &Env, owner: &Address) {
        Self::init_owner(env, owner);
    }
}

#[contract_impl]
impl IDvnFeeLib for DvnFeeLib {
    fn get_fee(env: &Env, _dvn: &Address, params: &DvnFeeParams) -> i128 {
        assert_with_error!(env, params.gas != 0, DvnFeeLibError::EidNotSupported);
        assert_with_error!(env, params.options.is_empty(), DvnFeeLibError::InvalidDVNOptions);

        let call_data_size = get_call_data_size(params.quorum);

        // Get estimated fee from price feed
        let price_feed_client = LayerZeroPriceFeedClient::new(env, &params.price_feed);
        let fee_result = price_feed_client.estimate_fee_by_eid(
            &env.current_contract_address(),
            &params.dst_eid,
            &call_data_size,
            &params.gas,
        );

        apply_premium(
            env,
            fee_result.total_gas_fee,
            params.multiplier_bps,
            params.default_multiplier_bps,
            params.floor_margin_usd,
            fee_result.native_price_usd,
        )
    }

    fn version(_env: &Env) -> (u64, u32) {
        (1, 1)
    }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/// Applies premium (multiplier and margin) to the base fee.
///
/// Calculates fee with multiplier and floor margin, returning the maximum of both
/// to ensure profitability.
///
/// # Arguments
/// * `fee` - Base gas fee
/// * `multiplier_bps` - Destination-specific multiplier in basis points
/// * `default_multiplier_bps` - Default multiplier if destination multiplier is 0
/// * `floor_margin_usd` - Minimum margin in USD (scaled)
/// * `native_price_usd` - Native token price in USD (scaled)
///
/// # Returns
/// Fee with premium applied (max of multiplier fee and margin fee).
fn apply_premium(
    env: &Env,
    fee: i128,
    multiplier_bps: u32,
    default_multiplier_bps: u32,
    floor_margin_usd: u128,
    native_price_usd: u128,
) -> i128 {
    assert_with_error!(env, fee >= 0, DvnFeeLibError::InvalidFee);

    let effective_multiplier_bps = if multiplier_bps == 0 { default_multiplier_bps } else { multiplier_bps };
    let fee_with_multiplier = fee * (effective_multiplier_bps as i128) / BPS_BASE;
    if native_price_usd == 0 || floor_margin_usd == 0 {
        return fee_with_multiplier;
    }

    let floor_margin_in_native = safe_u128_to_i128(env, floor_margin_usd * NATIVE_DECIMALS_RATE / native_price_usd);
    let fee_with_floor_margin = fee + floor_margin_in_native;

    fee_with_floor_margin.max(fee_with_multiplier)
}

/// Calculates the total calldata size for DVN verification.
///
/// Includes execute function overhead, verify function bytes, and padded signature bytes.
/// Signature bytes are padded to 32-byte boundaries for efficient EVM processing.
///
/// # Arguments
/// * `quorum` - Number of signatures required
///
/// # Returns
/// Total calldata size in bytes.
fn get_call_data_size(quorum: u32) -> u32 {
    let mut total_signature_bytes = quorum * SIGNATURE_RAW_BYTES;
    if !total_signature_bytes.is_multiple_of(32) {
        total_signature_bytes = total_signature_bytes - (total_signature_bytes % 32) + 32;
    }
    EXECUTE_FIXED_BYTES + VERIFY_BYTES + total_signature_bytes + 32
}

/// Safely converts u128 to i128, panicking if value exceeds i128::MAX.
fn safe_u128_to_i128(env: &Env, value: u128) -> i128 {
    assert_with_error!(env, value <= i128::MAX as u128, DvnFeeLibError::Overflow);
    value as i128
}

/// Test-only module exposing internal items for unit and integration tests.
#[cfg(test)]
pub(crate) mod test {
    use super::*;

    // Re-export constants for testing
    pub const BPS_BASE: i128 = super::BPS_BASE;
    pub const EXECUTE_FIXED_BYTES: u32 = super::EXECUTE_FIXED_BYTES;
    pub const VERIFY_BYTES: u32 = super::VERIFY_BYTES;
    pub const NATIVE_DECIMALS_RATE: u128 = super::NATIVE_DECIMALS_RATE;

    /// Test-only wrapper for apply_premium to enable testing.
    pub fn apply_premium_for_test(
        env: &Env,
        fee: i128,
        multiplier_bps: u32,
        default_multiplier_bps: u32,
        floor_margin_usd: u128,
        native_price_usd: u128,
    ) -> i128 {
        super::apply_premium(env, fee, multiplier_bps, default_multiplier_bps, floor_margin_usd, native_price_usd)
    }

    /// Test-only wrapper for get_call_data_size to enable testing.
    pub fn get_call_data_size_for_test(quorum: u32) -> u32 {
        super::get_call_data_size(quorum)
    }
}
