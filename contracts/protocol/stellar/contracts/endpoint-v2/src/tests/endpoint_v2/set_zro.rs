use soroban_sdk::{testutils::Address as _, Address};
use utils::testing_utils::assert_eq_event;

use crate::{events::ZroSet, tests::endpoint_setup::setup, tests::endpoint_setup::TestSetup};

// Helpers
fn set_zro_with_auth(context: &TestSetup, zro: &Address) {
    context.mock_owner_auth("set_zro", (zro,));
    context.endpoint_client.set_zro(zro);
}

// Success path (state update + event emission)
#[test]
fn test_set_zro() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Verify initial state - ZRO should not be set
    let initial_zro = endpoint_client.zro();
    assert_eq!(initial_zro, None, "Initial ZRO should be None");

    set_zro_with_auth(&context, &context.zro_token_client.address);

    // Verify event emission.
    assert_eq_event(env, &endpoint_client.address, ZroSet { zro: context.zro_token_client.address.clone() });

    // Verify state update via public interface.
    let zro_token = endpoint_client.zro();
    assert_eq!(zro_token, Some(context.zro_token_client.address.clone()));
}

#[test]
fn test_set_zro_overwrites_existing_zro() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Create a second token address to overwrite with.
    let owner = context.owner.clone();
    let zro_token_2 = env.register_stellar_asset_contract_v2(owner);
    let zro_addr_2 = zro_token_2.address();

    // Set ZRO to the first address.
    set_zro_with_auth(&context, &context.zro_token_client.address);
    assert_eq_event(env, &endpoint_client.address, ZroSet { zro: context.zro_token_client.address.clone() });
    assert_eq!(endpoint_client.zro(), Some(context.zro_token_client.address.clone()));

    // Overwrite ZRO with the second address.
    set_zro_with_auth(&context, &zro_addr_2);
    assert_eq_event(env, &endpoint_client.address, ZroSet { zro: zro_addr_2.clone() });
    assert_eq!(endpoint_client.zro(), Some(zro_addr_2));
}

#[test]
fn test_set_zro_is_idempotent_for_same_value() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    // Setting the same ZRO twice should succeed and keep state unchanged.
    set_zro_with_auth(&context, &context.zro_token_client.address);
    set_zro_with_auth(&context, &context.zro_token_client.address);

    assert_eq!(endpoint_client.zro(), Some(context.zro_token_client.address.clone()));
}

// Authorization (only owner)
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_zro_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let unauthorized = soroban_sdk::Address::generate(env);

    // Unauthorized caller must not be able to set ZRO.
    context.mock_auth(&unauthorized, "set_zro", (&context.zro_token_client.address,));
    endpoint_client.set_zro(&context.zro_token_client.address);
}
