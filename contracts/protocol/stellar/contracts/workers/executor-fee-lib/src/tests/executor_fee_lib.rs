use fee_lib_interfaces::{FeeEstimate, FeeParams};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Bytes, Env};

use crate::errors::ExecutorFeeLibError;
use crate::ExecutorFeeLib;

use super::setup::{
    bytes32, option_lz_compose, option_lz_receive, option_native_drop, option_ordered_execution, TestSetup,
};

// Mock contracts

#[contract]
struct MockPriceFeedEchoGas;

#[contractimpl]
impl MockPriceFeedEchoGas {
    // Returns total_gas_fee = gas, ratio=1, denom=1, native_price_usd=0
    pub fn estimate_fee_by_eid(
        _env: &Env,
        _fee_lib: &Address,
        _dst_eid: u32,
        _calldata_size: u32,
        gas: u128,
    ) -> FeeEstimate {
        FeeEstimate { total_gas_fee: gas as i128, price_ratio: 1, price_ratio_denominator: 1, native_price_usd: 0 }
    }
}

#[contract]
struct MockPriceFeedNegativeFee;

#[contractimpl]
impl MockPriceFeedNegativeFee {
    // Returns negative total_gas_fee to trigger InvalidFee error
    pub fn estimate_fee_by_eid(
        _env: &Env,
        _fee_lib: &Address,
        _dst_eid: u32,
        _calldata_size: u32,
        _gas: u128,
    ) -> FeeEstimate {
        FeeEstimate { total_gas_fee: -1, price_ratio: 1, price_ratio_denominator: 1, native_price_usd: 0 }
    }
}

#[contract]
struct MockPriceFeedWithRatio;

#[contractimpl]
impl MockPriceFeedWithRatio {
    // Returns configurable values for testing value conversion and margin
    pub fn estimate_fee_by_eid(
        _env: &Env,
        _fee_lib: &Address,
        _dst_eid: u32,
        _calldata_size: u32,
        gas: u128,
    ) -> FeeEstimate {
        FeeEstimate {
            total_gas_fee: gas as i128,
            price_ratio: 20_000_000_000,             // 2e10 (2:1 ratio)
            price_ratio_denominator: 10_000_000_000, // 1e10
            native_price_usd: 20_000_000_000_000,    // 2000e10
        }
    }
}

// version

#[test]
fn test_version() {
    let setup = TestSetup::new();
    assert_eq!(setup.client.version(), (1, 1));
}

// get_fee

#[test]
fn test_get_fee_basic_lz_receive_only() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    // Simple case: only lzReceive gas
    let mut options = Bytes::new(&setup.env);
    options.append(&option_lz_receive(&setup.env, 200_000, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_gas = base(1) + lzReceive(200,000) = 200,001
    // no value, multiplier=1.0x => fee = 200,001
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 200_001);
}

#[test]
fn test_get_fee_lz_receive_with_value_on_v2() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    // lzReceive with value (32 bytes format) - allowed on V2
    let mut options = Bytes::new(&setup.env);
    options.append(&option_lz_receive(&setup.env, 200_000, Some(5)));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000, // V2
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_gas = 1 + 200,000 = 200,001
    // total_value = 5, ratio=1, denom=1 => value_fee = 5
    // total = 200,006
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 200_006);
}

#[test]
fn test_get_fee_multiple_lz_receive_accumulates_gas() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    // Multiple lzReceive options should accumulate gas
    let mut options = Bytes::new(&setup.env);
    options.append(&option_lz_receive(&setup.env, 20, None));
    options.append(&option_lz_receive(&setup.env, 30, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_gas = base(1) + lzReceive(20 + 30) = 51
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 51);
}

#[test]
fn test_get_fee_multiple_native_drop_accumulates_value() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    let receiver1 = bytes32(&setup.env, 0xAA);
    let receiver2 = bytes32(&setup.env, 0xBB);
    let mut options = Bytes::new(&setup.env);
    options.append(&option_lz_receive(&setup.env, 10, None));
    options.append(&option_native_drop(&setup.env, 5, &receiver1));
    options.append(&option_native_drop(&setup.env, 7, &receiver2));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_gas = 1 + 10 = 11
    // total_value = 5 + 7 = 12
    // fee = 11 + 12 = 23
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 23);
}

#[test]
fn test_get_fee_multiple_lz_compose_accumulates_gas_and_value() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    let mut options = Bytes::new(&setup.env);
    options.append(&option_lz_receive(&setup.env, 10, None));
    options.append(&option_lz_compose(&setup.env, 0, 20, Some(3)));
    options.append(&option_lz_compose(&setup.env, 1, 30, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 15,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_gas = base(1) + lzReceive(10) + lzCompose(20+30) + compose_base(15*2) = 91
    // total_value = 3
    // fee = 91 + 3 = 94
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 94);
}

#[test]
fn test_get_fee_ordered_execution_adds_overhead() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    let mut options = Bytes::new(&setup.env);
    // lz_receive_gas must be non-zero (use larger gas to show ordered overhead)
    options.append(&option_lz_receive(&setup.env, 9_000, None));
    options.append(&option_ordered_execution(&setup.env));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1_000,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_gas = base(1_000) + lzReceive(9_000) = 10_000, with ordered: (10_000 * 102) / 100 = 10_200
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 10_200);
}

#[test]
fn test_get_fee_computes_gas_and_value_components() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    // Build options:
    // - lzReceive gas=9_000, value=0
    // - nativeDrop amount=700
    // - lzCompose index=0 gas=3_000 value=500
    // - ordered execution enabled
    let receiver = bytes32(&setup.env, 0xAB);
    let mut options = Bytes::new(&setup.env);
    options.append(&option_lz_receive(&setup.env, 9_000, None));
    options.append(&option_native_drop(&setup.env, 700, &receiver));
    options.append(&option_lz_compose(&setup.env, 0, 3_000, Some(500)));
    options.append(&option_ordered_execution(&setup.env));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000, // v2
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1_000,
        lz_compose_base_gas: 2_000,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_value = nativeDrop(700) + lzCompose.value(500) = 1_200
    // total_gas before ordered = base_receive(1_000) + lzReceive(9_000) + lzCompose(3_000) + compose_base(2_000*1) = 15_000
    // ordered overhead: (15_000 * 102) / 100 = 15_300
    // MockPriceFeedEchoGas returns total_gas_fee = gas (15_300), ratio=1, denom=1
    // multiplier=1.0x, so gas fee stays 15_300; value fee = 1_200
    // total = 16_500
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 16_500);
}

#[test]
fn test_get_fee_uses_dst_multiplier_when_nonzero() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    let mut options = Bytes::new(&setup.env);
    // lz_receive_gas must be non-zero (use larger gas to show multiplier effect)
    options.append(&option_lz_receive(&setup.env, 9_000, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1_000,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 15_000, // 1.5x
    };

    // total_gas = base(1_000) + lzReceive(9_000) = 10_000, multiplier = 1.5x => (10_000 * 15000) / 10000 = 15_000
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 15_000);
}

#[test]
fn test_get_fee_uses_default_multiplier_when_multiplier_bps_is_zero() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedEchoGas, ());

    let mut options = Bytes::new(&setup.env);
    // lz_receive_gas must be non-zero (use larger gas to show multiplier effect)
    options.append(&option_lz_receive(&setup.env, 9_000, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000, // 1.2x
        lz_receive_base_gas: 1_000,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 0, // Use default
    };

    // total_gas = base(1_000) + lzReceive(9_000) = 10_000, multiplier = 1.2x => (10_000 * 12000) / 10000 = 12_000
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 12_000);
}

#[test]
fn test_get_fee_converts_and_multiplies_native_value() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedWithRatio, ());

    let receiver = bytes32(&setup.env, 0xAB);
    let mut options = Bytes::new(&setup.env);
    // lz_receive_gas must be non-zero
    options.append(&option_lz_receive(&setup.env, 1, None));
    options.append(&option_native_drop(&setup.env, 10, &receiver));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 222_000,
        multiplier_bps: 10_000, // 1.0x
    };

    // total_gas = base(1) + lzReceive(1) = 2, gas_fee = 2
    // total_value = 10, ratio=2e10, denom=1e10 => converted = (10 * 2e10) / 1e10 = 20
    // value_fee = (20 * 10000) / 10000 = 20
    // total = 2 (gas) + 20 (value) = 22
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 22);
}

#[test]
fn test_get_fee_applies_floor_margin_when_gas_fee_is_low() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedWithRatio, ());

    let mut options = Bytes::new(&setup.env);
    // lz_receive_gas must be non-zero
    options.append(&option_lz_receive(&setup.env, 1, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 30_000_000_000, // 3e10
        native_cap: 222_000,
        multiplier_bps: 10_000,
    };

    // total_gas = 2, gas_fee = 2
    // margin_usd=3e10, native_price_usd=2000e10 => margin_in_native = (3e10 * 10^7) / 2000e10 = 15000
    // fee_with_margin = 2 + 15000 = 15002, fee_with_multiplier = 2
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 15002);
}

#[test]
fn test_get_fee_multiplier_wins_over_floor_margin() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedWithRatio, ());

    let mut options = Bytes::new(&setup.env);
    // lz_receive_gas must be non-zero
    options.append(&option_lz_receive(&setup.env, 100_000, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 30_000_000_000, // 3e10
        native_cap: 222_000,
        multiplier_bps: 15_000,
    };

    // total_gas = 100,001, gas_fee = 100,001
    // margin_usd=3e10, native_price_usd=2000e10 => margin_in_native = 15000
    // fee_with_margin = 100,001 + 15000 = 115,001
    // fee_with_multiplier = (100,001 * 15000) / 10000 = 150,001
    let executor = Address::generate(&setup.env);
    let fee = setup.client.get_fee(&executor, &params);
    assert_eq!(fee, 150_001);
}

#[test]
fn test_get_fee_errors_eid_not_supported_when_base_gas_zero() {
    let setup = TestSetup::new();

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options: Bytes::new(&setup.env),
        price_feed: Address::generate(&setup.env),
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 0,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 0,
        multiplier_bps: 0,
    };

    let executor = Address::generate(&setup.env);
    assert_eq!(
        setup.client.try_get_fee(&executor, &params).unwrap_err().unwrap(),
        ExecutorFeeLibError::EidNotSupported.into()
    );
}

#[test]
fn test_get_fee_errors_no_options() {
    let setup = TestSetup::new();

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options: Bytes::new(&setup.env),
        price_feed: Address::generate(&setup.env), // not called (fails during option parsing)
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 1_000,
        multiplier_bps: 10_000,
    };

    let executor = Address::generate(&setup.env);
    assert_eq!(
        setup.client.try_get_fee(&executor, &params).unwrap_err().unwrap(),
        ExecutorFeeLibError::NoOptions.into()
    );
}

#[test]
fn test_get_fee_errors_invalid_fee_when_price_feed_returns_negative_total_gas_fee() {
    let setup = TestSetup::new();
    let price_feed = setup.env.register(MockPriceFeedNegativeFee, ());

    let mut options = Bytes::new(&setup.env);
    options.append(&option_lz_receive(&setup.env, 1, None));

    let params = FeeParams {
        sender: Address::generate(&setup.env),
        dst_eid: 30_000,
        calldata_size: 0,
        options,
        price_feed,
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 0,
        multiplier_bps: 10_000,
    };

    let executor = Address::generate(&setup.env);
    assert_eq!(
        setup.client.try_get_fee(&executor, &params).unwrap_err().unwrap(),
        ExecutorFeeLibError::InvalidFee.into()
    );
}

// internal helpers

#[test]
fn test_is_v1_eid() {
    let env = Env::default();

    // V1: eid < 30000
    assert_eq!(ExecutorFeeLib::is_v1_eid_for_test(&env, 0), true);
    assert_eq!(ExecutorFeeLib::is_v1_eid_for_test(&env, 1), true);
    assert_eq!(ExecutorFeeLib::is_v1_eid_for_test(&env, 29_999), true);

    // V2: eid >= 30000
    assert_eq!(ExecutorFeeLib::is_v1_eid_for_test(&env, 30_000), false);
    assert_eq!(ExecutorFeeLib::is_v1_eid_for_test(&env, 30_001), false);
}

#[test]
fn test_safe_u128_to_i128() {
    let env = Env::default();

    assert_eq!(ExecutorFeeLib::safe_u128_to_i128_for_test(&env, 0), 0);
    assert_eq!(ExecutorFeeLib::safe_u128_to_i128_for_test(&env, 123), 123);
    assert_eq!(ExecutorFeeLib::safe_u128_to_i128_for_test(&env, i128::MAX as u128), i128::MAX);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")] // ExecutorFeeLibError::Overflow
fn test_safe_u128_to_i128_overflow() {
    let env = Env::default();
    // Value exceeds i128::MAX, should panic with Overflow error
    let _ = ExecutorFeeLib::safe_u128_to_i128_for_test(&env, (i128::MAX as u128) + 1);
}

#[test]
fn test_get_effective_multiplier_bps() {
    let env = Env::default();

    // When multiplier_bps == 0, use default
    let params = FeeParams {
        sender: Address::generate(&env),
        dst_eid: 1,
        calldata_size: 1,
        options: Bytes::new(&env),
        price_feed: Address::generate(&env),
        default_multiplier_bps: 12_000,
        lz_receive_base_gas: 1,
        lz_compose_base_gas: 0,
        floor_margin_usd: 0,
        native_cap: 0,
        multiplier_bps: 0,
    };
    assert_eq!(ExecutorFeeLib::get_effective_multiplier_bps_for_test(&env, &params), 12_000);

    // When multiplier_bps != 0, use it instead of default
    let params = FeeParams { multiplier_bps: 15_000, ..params };
    assert_eq!(ExecutorFeeLib::get_effective_multiplier_bps_for_test(&env, &params), 15_000);
}

#[test]
fn test_apply_premium_to_gas_multiplier_only() {
    let env = Env::default();

    // When native_price_usd == 0, only apply fee_with_multiplier
    let fee = ExecutorFeeLib::apply_premium_to_gas_for_test(&env, 100, 12_000, 10, 0);
    assert_eq!(fee, 120); // (100 * 12000) / 10000 = 120

    // When margin_usd == 0, only apply fee_with_multiplier
    let fee = ExecutorFeeLib::apply_premium_to_gas_for_test(&env, 100, 12_000, 0, 20_000_000_000_000);
    assert_eq!(fee, 120);
}

#[test]
fn test_apply_premium_to_gas_margin_wins() {
    let env = Env::default();

    // margin_usd=3e10, native_price_usd=2000e10
    // margin_in_native = (3e10 * 10^7) / 2000e10 = 15000
    // fee_with_margin = 15000 + 100 = 15100
    // fee_with_multiplier = (100 * 10000) / 10000 = 100
    // max(15100, 100) = 15100
    let fee = ExecutorFeeLib::apply_premium_to_gas_for_test(&env, 100, 10_000, 30_000_000_000, 20_000_000_000_000);
    assert_eq!(fee, 15100);
}

#[test]
fn test_apply_premium_to_gas_multiplier_wins() {
    let env = Env::default();

    // margin_usd=1e9, native_price_usd=2000e10 => margin_in_native = (1e9 * 10^7) / 2000e10 = 500
    // fee_with_margin = 500 + 100 = 600
    // fee_with_multiplier = (100 * 15000) / 10000 = 150
    // In this case margin wins if we use fee=100.
    // Let's use fee=2000.
    // fee=2000, multiplier=1.5x => 3000
    // fee_with_margin = 500 + 2000 = 2500
    // max(2500, 3000) = 3000
    let fee = ExecutorFeeLib::apply_premium_to_gas_for_test(&env, 2000, 15_000, 1_000_000_000, 20_000_000_000_000);
    assert_eq!(fee, 3000);
}

#[test]
fn test_convert_and_apply_premium_to_value() {
    let env = Env::default();

    // When value == 0, return 0 immediately
    let fee =
        ExecutorFeeLib::convert_and_apply_premium_to_value_for_test(&env, 0, 10_000_000_000, 10_000_000_000, 12_000);
    assert_eq!(fee, 0);

    // Normal case: value=10, ratio=2:1, multiplier=1.2x
    // converted = (10 * 2e10) / 1e10 = 20
    // fee = (20 * 12000) / 10000 = 24
    let fee =
        ExecutorFeeLib::convert_and_apply_premium_to_value_for_test(&env, 10, 20_000_000_000, 10_000_000_000, 12_000);
    assert_eq!(fee, 24);
}

#[test]
fn test_decode_executor_options() {
    let env = Env::default();

    // Only lzReceive
    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 50, None));
    let (value, gas) = ExecutorFeeLib::decode_executor_options_for_test(&env, &options, 30_000, 1, 20, 222_000);
    assert_eq!(value, 0);
    assert_eq!(gas, 51); // base(1) + lzReceive(50)

    // lzReceive with value
    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 50, Some(25)));
    let (value, gas) = ExecutorFeeLib::decode_executor_options_for_test(&env, &options, 30_000, 1, 20, 222_000);
    assert_eq!(value, 25);
    assert_eq!(gas, 51);

    // With nativeDrop
    let receiver = bytes32(&env, 0xAB);
    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 10, None));
    options.append(&option_native_drop(&env, 30, &receiver));
    let (value, gas) = ExecutorFeeLib::decode_executor_options_for_test(&env, &options, 30_000, 1, 20, 222_000);
    assert_eq!(value, 30);
    assert_eq!(gas, 11);

    // With lzCompose (gas + value + compose_base)
    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 10, None));
    options.append(&option_lz_compose(&env, 0, 30, Some(5)));
    let (value, gas) = ExecutorFeeLib::decode_executor_options_for_test(&env, &options, 30_000, 1, 20, 222_000);
    assert_eq!(value, 5);
    assert_eq!(gas, 61); // base(1) + lzReceive(10) + lzCompose(30) + compose_base(20*1)

    // With ordered execution overhead (lz_receive_gas must be non-zero)
    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 9_000, None));
    options.append(&option_ordered_execution(&env));
    let (value, gas) = ExecutorFeeLib::decode_executor_options_for_test(&env, &options, 30_000, 1_000, 0, 222_000);
    assert_eq!(value, 0);
    assert_eq!(gas, 10_200); // ((1_000 + 9_000) * 102) / 100 = 10_200
}
