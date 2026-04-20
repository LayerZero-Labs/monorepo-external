use soroban_sdk::{testutils::Address as _, Address};

use crate::tests::endpoint_setup::setup;
#[test]
fn test_delegate_when_not_set() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    let actual_delegate = endpoint_client.delegate(&oapp);
    assert_eq!(actual_delegate, None, "Delegate should not be set");
}

#[test]
fn test_delegate_when_set() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);

    let delegate_option = Some(delegate.clone());
    context.set_delegate_with_auth(&oapp, &delegate_option);

    let actual_delegate = endpoint_client.delegate(&oapp);
    assert_eq!(actual_delegate, Some(delegate), "Delegate should be set");
}
