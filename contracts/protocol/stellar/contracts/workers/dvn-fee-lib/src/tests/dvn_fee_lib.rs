use crate::test::{
    apply_premium_for_test, get_call_data_size_for_test, BPS_BASE, EXECUTE_FIXED_BYTES, NATIVE_DECIMALS_RATE,
    VERIFY_BYTES,
};
use crate::DvnFeeLib;
use fee_lib_interfaces::{DvnFeeParams, FeeEstimate, IDvnFeeLib};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Bytes, Env};

#[test]
fn get_call_data_size_pads_signatures() {
    let size = get_call_data_size_for_test(1);
    assert_eq!(size, EXECUTE_FIXED_BYTES + VERIFY_BYTES + 96 + 32);

    let size = get_call_data_size_for_test(2);
    assert_eq!(size, EXECUTE_FIXED_BYTES + VERIFY_BYTES + 160 + 32);

    let size = get_call_data_size_for_test(32);
    assert_eq!(size, EXECUTE_FIXED_BYTES + VERIFY_BYTES + 2080 + 32);
}

#[test]
fn apply_premium_multiplier_only_both_zero() {
    let env = Env::default();
    let fee = 1_000i128;
    let multiplier_bps = 15_000u32;
    // multiplier_bps is non-zero, so default_multiplier_bps is ignored
    let result = apply_premium_for_test(&env, fee, multiplier_bps, 10_000, 0, 0);
    assert_eq!(result, fee * multiplier_bps as i128 / BPS_BASE);
}

#[test]
fn apply_premium_multiplier_only_native_price_zero() {
    let env = Env::default();
    let fee = 1_000i128;
    let multiplier_bps = 15_000u32;
    let result = apply_premium_for_test(&env, fee, multiplier_bps, 10_000, 100, 0);
    assert_eq!(result, fee * multiplier_bps as i128 / BPS_BASE);
}

#[test]
fn apply_premium_multiplier_only_floor_margin_zero() {
    let env = Env::default();
    let fee = 1_000i128;
    let multiplier_bps = 15_000u32;
    let result = apply_premium_for_test(&env, fee, multiplier_bps, 10_000, 0, NATIVE_DECIMALS_RATE);
    assert_eq!(result, fee * multiplier_bps as i128 / BPS_BASE);
}

#[test]
fn apply_premium_uses_default_when_multiplier_zero() {
    let env = Env::default();
    let fee = 1_000i128;
    let default_bps = 12_000u32;
    // multiplier_bps is 0, so default_multiplier_bps should be used
    let result = apply_premium_for_test(&env, fee, 0, default_bps, 0, 0);
    assert_eq!(result, fee * default_bps as i128 / BPS_BASE);
}

#[test]
fn apply_premium_floor_margin_wins() {
    let env = Env::default();
    let fee = 1_000i128;
    let multiplier_bps = 10_000u32;
    let floor_margin_usd = 10u128;
    let native_price_usd = NATIVE_DECIMALS_RATE;

    let result = apply_premium_for_test(&env, fee, multiplier_bps, 10_000, floor_margin_usd, native_price_usd);
    assert_eq!(result, fee + floor_margin_usd as i128);
}

#[test]
fn apply_premium_multiplier_wins_over_small_floor() {
    let env = Env::default();
    let fee = 1_000i128;
    let multiplier_bps = 12_000u32;
    let floor_margin_usd = 1u128;
    let native_price_usd = NATIVE_DECIMALS_RATE;

    let result = apply_premium_for_test(&env, fee, multiplier_bps, 10_000, floor_margin_usd, native_price_usd);
    assert_eq!(result, 1_200);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // DvnFeeLibError::EidNotSupported
fn get_fee_panics_when_gas_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let fee_lib_addr = env.register(DvnFeeLib, (&owner,));
    let params = DvnFeeParams {
        sender: Address::generate(&env),
        dst_eid: 1,
        confirmations: 1,
        options: Bytes::new(&env),
        price_feed: Address::generate(&env),
        default_multiplier_bps: 10_000,
        quorum: 1,
        gas: 0, // Zero gas should panic
        multiplier_bps: 10_000,
        floor_margin_usd: 0,
    };

    env.as_contract(&fee_lib_addr, || DvnFeeLib::get_fee(&env, &fee_lib_addr, &params));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // DvnFeeLibError::InvalidDVNOptions
fn get_fee_panics_when_options_not_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let fee_lib_addr = env.register(DvnFeeLib, (&owner,));
    let options = Bytes::from_slice(&env, &[1u8]);

    let params = DvnFeeParams {
        sender: Address::generate(&env),
        dst_eid: 1,
        confirmations: 1,
        options, // Non-empty options should panic
        price_feed: Address::generate(&env),
        default_multiplier_bps: 10_000,
        quorum: 1,
        gas: 1,
        multiplier_bps: 10_000,
        floor_margin_usd: 0,
    };

    env.as_contract(&fee_lib_addr, || DvnFeeLib::get_fee(&env, &fee_lib_addr, &params));
}

#[contract]
struct MockPriceFeed;

#[contractimpl]
impl MockPriceFeed {
    pub fn estimate_fee_by_eid(
        _env: &Env,
        _fee_lib: &Address,
        _dst_eid: u32,
        _calldata_size: u32,
        _gas: u128,
    ) -> FeeEstimate {
        FeeEstimate {
            total_gas_fee: 100,
            price_ratio: 0,
            price_ratio_denominator: 0,
            native_price_usd: NATIVE_DECIMALS_RATE,
        }
    }

    pub fn native_token_price_usd(_env: &Env) -> u128 {
        NATIVE_DECIMALS_RATE
    }

    pub fn set_native_token_price_usd(_env: &Env, _price_updater: &Address, _native_token_price_usd: u128) {}
}

#[contract]
struct MockPriceFeedNegative;

#[contractimpl]
impl MockPriceFeedNegative {
    pub fn estimate_fee_by_eid(
        _env: &Env,
        _fee_lib: &Address,
        _dst_eid: u32,
        _calldata_size: u32,
        _gas: u128,
    ) -> FeeEstimate {
        FeeEstimate {
            total_gas_fee: -100,
            price_ratio: 0,
            price_ratio_denominator: 0,
            native_price_usd: NATIVE_DECIMALS_RATE,
        }
    }
}

#[test]
fn get_fee_success_path() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let fee_lib_addr = env.register(DvnFeeLib, (&owner,));
    let params = DvnFeeParams {
        sender: Address::generate(&env),
        dst_eid: 7,
        confirmations: 1,
        options: Bytes::new(&env),
        price_feed: env.register(MockPriceFeed, ()),
        default_multiplier_bps: 10_000,
        quorum: 2,
        gas: 100,
        multiplier_bps: 10_000,
        floor_margin_usd: 0,
    };

    let fee = env.as_contract(&fee_lib_addr, || DvnFeeLib::get_fee(&env, &fee_lib_addr, &params));

    assert_eq!(fee, 100);
}

#[test]
fn get_fee_uses_default_multiplier_when_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let fee_lib_addr = env.register(DvnFeeLib, (&owner,));

    // multiplier_bps = 0, default_multiplier_bps = 12000 (1.2x)
    // MockPriceFeed returns fee=100, so result = 100 * 12000 / 10000 = 120
    let params = DvnFeeParams {
        sender: Address::generate(&env),
        dst_eid: 7,
        confirmations: 1,
        options: Bytes::new(&env),
        price_feed: env.register(MockPriceFeed, ()),
        default_multiplier_bps: 12_000,
        quorum: 2,
        gas: 100,
        multiplier_bps: 0, // Zero means use default
        floor_margin_usd: 0,
    };

    let fee = env.as_contract(&fee_lib_addr, || DvnFeeLib::get_fee(&env, &fee_lib_addr, &params));

    assert_eq!(fee, 120);
}

#[test]
fn get_fee_prefers_dst_multiplier_over_default() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let fee_lib_addr = env.register(DvnFeeLib, (&owner,));

    // multiplier_bps = 15000 (1.5x), default_multiplier_bps = 10000 (1.0x)
    // MockPriceFeed returns fee=100, so result = 100 * 15000 / 10000 = 150
    let params = DvnFeeParams {
        sender: Address::generate(&env),
        dst_eid: 7,
        confirmations: 1,
        options: Bytes::new(&env),
        price_feed: env.register(MockPriceFeed, ()),
        default_multiplier_bps: 10_000,
        quorum: 2,
        gas: 100,
        multiplier_bps: 15_000, // Prefer this over default
        floor_margin_usd: 0,
    };

    let fee = env.as_contract(&fee_lib_addr, || DvnFeeLib::get_fee(&env, &fee_lib_addr, &params));

    assert_eq!(fee, 150);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // DvnFeeLibError::NegativeFee
fn get_fee_panics_when_price_feed_returns_negative_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let fee_lib_addr = env.register(DvnFeeLib, (&owner,));
    let params = DvnFeeParams {
        sender: Address::generate(&env),
        dst_eid: 7,
        confirmations: 1,
        options: Bytes::new(&env),
        price_feed: env.register(MockPriceFeedNegative, ()),
        default_multiplier_bps: 10_000,
        quorum: 2,
        gas: 100,
        multiplier_bps: 10_000,
        floor_margin_usd: 0,
    };

    env.as_contract(&fee_lib_addr, || DvnFeeLib::get_fee(&env, &fee_lib_addr, &params));
}

#[test]
#[should_panic]
fn apply_premium_panics_on_overflow() {
    let env = Env::default();
    let fee = i128::MAX / 2;
    let multiplier_bps = 20_000u32;
    apply_premium_for_test(&env, fee, multiplier_bps, 10_000, u128::MAX, 1);
}

#[test]
fn apply_premium_floor_margin_truncates() {
    let env = Env::default();
    let fee = 0i128;
    let multiplier_bps = 10_000u32;
    let floor_margin_usd = 1u128;
    let native_price_usd = NATIVE_DECIMALS_RATE * 3 / 2;

    let result = apply_premium_for_test(&env, fee, multiplier_bps, 10_000, floor_margin_usd, native_price_usd);
    assert_eq!(result, 0);
}
