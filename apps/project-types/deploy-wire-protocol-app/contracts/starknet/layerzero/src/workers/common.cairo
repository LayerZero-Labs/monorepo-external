use core::cmp::max;
use crate::common::constants::{BPS_DENOMINATOR, NATIVE_DECIMALS_RATE};

/// Apply premium and floor margin to the fee
///
/// Returns the maximum between the fee with a multiplier and fee with the floor margin.
///
/// # Arguments
///
/// * `fee` - fee to apply premium to
/// * `bps` - base points to apply premium to, where 10000 = 100%
/// * `default_bps` - default bps to apply premium to
/// * `margin_usd` - margin in usd
/// * `native_price_usd` - native price in usd
///
/// # Returns
///
/// * `fee_with_premium` - fee with premium applied
pub fn apply_premium_and_floor_margin(
    fee: u256, bps: u16, default_bps: u16, margin_usd: u128, native_price_usd: u128,
) -> u256 {
    let multiplier_bps = if bps == 0 {
        default_bps
    } else {
        bps
    };

    // fee with multiplier, divides by BPS_DENOMINATOR to get the percentage
    let fee_with_multiplier = (fee * multiplier_bps.into()) / BPS_DENOMINATOR;
    if native_price_usd == 0 || margin_usd == 0 {
        return fee_with_multiplier;
    }

    // fee with floor margin, divides by native_price_usd to get the amount of native tokens
    let fee_with_floor_margin = fee
        + (margin_usd.into() * NATIVE_DECIMALS_RATE) / native_price_usd.into();

    max(fee_with_floor_margin, fee_with_multiplier)
}

pub fn convert_and_apply_premium_to_value(
    value: u256, ratio: u128, denom: u128, bps: u16, default_bps: u16,
) -> u256 {
    let multiplier_bps = if bps == 0 {
        default_bps
    } else {
        bps
    };

    if value > 0 {
        (((value * ratio.into()) / denom.into()) * multiplier_bps.into()) / BPS_DENOMINATOR
    } else {
        0
    }
}
