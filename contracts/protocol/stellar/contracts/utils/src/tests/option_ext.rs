use crate::{errors::OwnableError, option_ext::OptionExt, tests::test_helper::assert_panics_contains};
use soroban_sdk::Env;

#[test]
fn unwrap_or_panic_some_returns_value() {
    let env = Env::default();
    let got = Some(123u32).unwrap_or_panic(&env, OwnableError::OwnerNotSet);
    assert_eq!(got, 123);
}

#[test]
fn unwrap_or_panic_none_panics_with_error() {
    const EXPECTED: &str = "Error(Contract, #1035)"; // OwnerNotSet
    assert_panics_contains("none unwrap_or_panic", EXPECTED, || {
        let env = Env::default();
        let _got: u32 = None::<u32>.unwrap_or_panic(&env, OwnableError::OwnerNotSet);
    });
}
