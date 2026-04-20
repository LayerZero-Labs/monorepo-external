use soroban_sdk::{testutils::Address as _, Address};
use utils::testing_utils::assert_eq_event;

use crate::{events::DelegateSet, tests::endpoint_setup::setup};

// Setting delegate (state update + event emission)
#[test]
fn test_set_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);

    // Verify initial state - delegate should not be set.
    let initial_delegate = endpoint_client.delegate(&oapp);
    assert_eq!(initial_delegate, None, "Initial delegate should be None");

    let delegate_option = Some(delegate.clone());
    context.set_delegate_with_auth(&oapp, &delegate_option);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        DelegateSet { oapp: oapp.clone(), delegate: Some(delegate.clone()) },
    );

    // Verify state update via public interface.
    let actual_delegate = endpoint_client.delegate(&oapp);
    assert_eq!(actual_delegate, Some(delegate.clone()), "Delegate should be set");
}

#[test]
fn test_set_delegate_overwrites_existing_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate_a = Address::generate(env);
    let delegate_b = Address::generate(env);

    // Set delegate to A.
    let delegate_a_opt = Some(delegate_a.clone());
    context.set_delegate_with_auth(&oapp, &delegate_a_opt);
    assert_eq_event(
        env,
        &endpoint_client.address,
        DelegateSet { oapp: oapp.clone(), delegate: Some(delegate_a.clone()) },
    );
    assert_eq!(endpoint_client.delegate(&oapp), Some(delegate_a.clone()));

    // Overwrite delegate with B.
    let delegate_b_opt = Some(delegate_b.clone());
    context.set_delegate_with_auth(&oapp, &delegate_b_opt);
    assert_eq_event(
        env,
        &endpoint_client.address,
        DelegateSet { oapp: oapp.clone(), delegate: Some(delegate_b.clone()) },
    );
    assert_eq!(endpoint_client.delegate(&oapp), Some(delegate_b.clone()));
}

#[test]
fn test_set_delegate_is_idempotent_for_same_value() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);
    let delegate_opt = Some(delegate.clone());

    // Setting the same delegate twice should succeed and keep state unchanged.
    context.set_delegate_with_auth(&oapp, &delegate_opt);
    context.set_delegate_with_auth(&oapp, &delegate_opt);

    assert_eq!(endpoint_client.delegate(&oapp), Some(delegate.clone()));
}

// Removing delegate (state update + event emission)
#[test]
fn test_set_delegate_remove() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);

    // First set a delegate.
    let delegate_option = Some(delegate.clone());
    context.set_delegate_with_auth(&oapp, &delegate_option);

    // Verify delegate was set.
    let stored_delegate = endpoint_client.delegate(&oapp);
    assert_eq!(stored_delegate, Some(delegate.clone()));

    // Now remove the delegate.
    let remove_option = None::<Address>;
    context.set_delegate_with_auth(&oapp, &remove_option);

    // Verify event emission.
    assert_eq_event(env, &endpoint_client.address, DelegateSet { oapp: oapp.clone(), delegate: None });

    // Verify state update via public interface.
    let stored_delegate_after = endpoint_client.delegate(&oapp);
    assert_eq!(stored_delegate_after, None, "Delegate should be removed");
}

// Authorization (only oapp)
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_delegate_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unauthorized_caller = Address::generate(env);
    let delegate = Address::generate(env);

    let delegate_option = Some(delegate);
    // Unauthorized caller must not be able to set delegate for an OApp.
    context.mock_auth(&unauthorized_caller, "set_delegate", (&oapp, &delegate_option));
    endpoint_client.set_delegate(&oapp, &delegate_option);
}
