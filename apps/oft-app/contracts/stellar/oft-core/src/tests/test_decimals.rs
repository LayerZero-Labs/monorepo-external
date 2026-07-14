use super::test_utils::OFTTestSetup;
use crate::{
    tests::test_utils::OFTTestSetupBuilder,
    utils::{to_ld, to_sd},
};
use soroban_sdk::Env;

#[test]
fn test_decimal_conversion_rate() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // SAC has 7 decimals, shared decimals is 6
    // conversion_rate = 10^(7-6) = 10
    let rate = setup.oft.decimal_conversion_rate();
    assert_eq!(rate, 10_i128.pow(setup.token_decimals - setup.shared_decimals));
}

#[test]
#[should_panic(expected = "Error(Contract, #3002)")] // InvalidLocalDecimals
fn test_invalid_local_decimals() {
    let env = Env::default();
    OFTTestSetupBuilder::new(&env).with_token_decimals(5).with_shared_decimals(6).build();
}

#[test]
#[should_panic]
fn test_to_ld_overflow() {
    // 10^38 * 10 > i128::MAX - should overflow
    let conversion_rate = 10_i128.pow(38);
    let amount_sd = 10u64;

    to_ld(amount_sd, conversion_rate);
}

#[test]
#[should_panic(expected = "Error(Contract, #3004)")] // Overflow
fn test_to_sd_overflow() {
    let env = Env::default();

    // u64::MAX + 1 exceeds u64 range - should overflow
    let conversion_rate = 1i128;
    let amount_ld = u64::MAX as i128 + 1;

    to_sd(&env, amount_ld, conversion_rate);
}

// ==================== Positive Conversion Tests ====================

#[test]
fn test_to_ld_basic() {
    // Conversion rate = 10 (7 decimals - 6 shared = 1 decimal difference)
    let conversion_rate = 10i128;

    assert_eq!(to_ld(0, conversion_rate), 0);
    assert_eq!(to_ld(1, conversion_rate), 10);
    assert_eq!(to_ld(100, conversion_rate), 1_000);
    assert_eq!(to_ld(1_000_000, conversion_rate), 10_000_000);
}

#[test]
fn test_to_sd_basic() {
    let env = Env::default();

    // Conversion rate = 10 (7 decimals - 6 shared = 1 decimal difference)
    let conversion_rate = 10i128;

    assert_eq!(to_sd(&env, 0, conversion_rate), 0);
    assert_eq!(to_sd(&env, 10, conversion_rate), 1);
    assert_eq!(to_sd(&env, 1_000, conversion_rate), 100);
    assert_eq!(to_sd(&env, 10_000_000, conversion_rate), 1_000_000);
}

#[test]
fn test_to_sd_truncates_dust() {
    let env = Env::default();

    // Conversion rate = 10
    let conversion_rate = 10i128;

    // 15 LD → 1 SD (5 is dust, truncated via division)
    assert_eq!(to_sd(&env, 15, conversion_rate), 1);

    // 19 LD → 1 SD (9 is dust, truncated)
    assert_eq!(to_sd(&env, 19, conversion_rate), 1);

    // 20 LD → 2 SD (exact)
    assert_eq!(to_sd(&env, 20, conversion_rate), 2);
}

// ==================== Shared Decimals Tests ====================

#[test]
fn test_shared_decimals_default() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Default setup: 7 local decimals, 6 shared decimals
    let shared = setup.oft.shared_decimals();
    assert_eq!(shared, setup.shared_decimals);
    assert_eq!(shared, 6);
}

#[test]
fn test_shared_decimals_equal_to_local() {
    let env = Env::default();
    // When shared_decimals == local_decimals, conversion_rate = 1
    let setup = OFTTestSetupBuilder::new(&env).with_token_decimals(8).with_shared_decimals(8).build();

    let shared = setup.oft.shared_decimals();
    assert_eq!(shared, 8);
    assert_eq!(setup.oft.decimal_conversion_rate(), 1);
}

#[test]
fn test_shared_decimals_large_difference() {
    let env = Env::default();
    // 18 local decimals, 6 shared decimals → conversion_rate = 10^12
    let setup = OFTTestSetupBuilder::new(&env).with_token_decimals(18).with_shared_decimals(6).build();

    let shared = setup.oft.shared_decimals();
    assert_eq!(shared, 6);
    assert_eq!(setup.oft.decimal_conversion_rate(), 10_i128.pow(12));
}
