use crate::u256_ext::U256Ext;
use soroban_sdk::{Env, U256};

#[test]
fn test_to_i128_with_small_value() {
    let env = Env::default();
    let val = U256::from_u128(&env, 100);
    assert_eq!(val.to_i128(), Some(100i128));
}

#[test]
fn test_to_i128_with_zero() {
    let env = Env::default();
    let val = U256::from_u128(&env, 0);
    assert_eq!(val.to_i128(), Some(0i128));
}

#[test]
fn test_to_i128_with_i128_max() {
    let env = Env::default();
    let val = U256::from_u128(&env, i128::MAX as u128);
    assert_eq!(val.to_i128(), Some(i128::MAX));
}

#[test]
fn test_to_i128_with_value_larger_than_i128_max_returns_none() {
    let env = Env::default();
    // i128::MAX + 1 should not fit in i128
    let val = U256::from_u128(&env, (i128::MAX as u128) + 1);
    assert_eq!(val.to_i128(), None);
}

#[test]
fn test_to_i128_with_u128_max_returns_none() {
    let env = Env::default();
    let val = U256::from_u128(&env, u128::MAX);
    assert_eq!(val.to_i128(), None);
}

#[test]
fn test_to_i128_with_high_bits_set_returns_none() {
    let env = Env::default();
    // Create a U256 with high 128 bits set (value > u128::MAX)
    // from_parts takes (hi_hi, hi_lo, lo_hi, lo_lo) where each is u64
    // Setting hi_hi or hi_lo to non-zero makes it > u128::MAX
    let val = U256::from_parts(&env, 1, 0, 0, 0); // Sets bits 192-255
    assert_eq!(val.to_i128(), None);
}
