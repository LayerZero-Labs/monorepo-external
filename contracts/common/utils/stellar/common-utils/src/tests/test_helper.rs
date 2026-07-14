// `utils` crate is `#![no_std]`, but unit tests can use `std`.
extern crate std;

use soroban_sdk::{
    address_payload::AddressPayload,
    testutils::{MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal, Val,
};

/// Same style as `common-macros` tests helper.
pub(in crate::tests) fn assert_panics_contains<F>(case: &str, expected_substring: &str, f: F)
where
    F: FnOnce(),
{
    use std::any::Any;
    use std::boxed::Box;
    use std::format;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::string::{String, ToString};

    let result = catch_unwind(AssertUnwindSafe(f));
    assert!(result.is_err(), "{case}: expected panic, but function returned normally");

    let payload: Box<dyn Any + Send> = result.expect_err("checked above");
    let msg = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        format!("{payload:?}")
    };

    assert!(
        msg.contains(expected_substring),
        "{case}: expected panic message to contain '{expected_substring}', got '{msg}'"
    );
}

/// Helper to assert address payload matches expected payload.
///
/// Used in buffer_reader and buffer_writer tests to verify address encoding/decoding.
pub(in crate::tests) fn assert_address_payload_matches(actual: BytesN<32>, expected: AddressPayload) {
    match expected {
        AddressPayload::ContractIdHash(expected_payload) => {
            assert_eq!(actual, expected_payload);
        }
        AddressPayload::AccountIdPublicKeyEd25519(expected_payload) => {
            assert_eq!(actual, expected_payload);
        }
    }
}

/// Test helper to mock a single contract invocation auth.
///
/// This keeps test files from repeating `env.mock_auths(&[MockAuth { ... }])` blocks.
pub(in crate::tests) fn mock_auth<A: IntoVal<Env, soroban_sdk::Vec<Val>>>(
    env: &Env,
    contract_id: &Address,
    address: &Address,
    fn_name: &'static str,
    args: A,
) {
    env.mock_auths(&[MockAuth {
        address,
        invoke: &MockAuthInvoke { contract: contract_id, args: args.into_val(env), fn_name, sub_invokes: &[] },
    }]);
}
