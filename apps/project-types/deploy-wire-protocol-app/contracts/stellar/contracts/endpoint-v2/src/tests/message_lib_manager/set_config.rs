use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, Vec};

use crate::{errors::EndpointError, tests::endpoint_setup::setup, tests::endpoint_setup::TestSetup, SetConfigParam};

// Helpers
fn set_config_with_auth(
    context: &TestSetup,
    caller: &Address,
    oapp: &Address,
    message_lib: &Address,
    params: &Vec<SetConfigParam>,
) {
    context.mock_auth(caller, "set_config", (caller, oapp, message_lib, params));
    context.endpoint_client.set_config(caller, oapp, message_lib, params);
}

// Authorization (caller == oapp)
#[test]
fn test_set_config_allows_oapp() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let message_lib = context.setup_mock_message_lib(crate::MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&message_lib);

    let cfg = Bytes::from_slice(env, &[0x01, 0x02, 0x03]);
    let params: Vec<SetConfigParam> =
        vec![env, SetConfigParam { eid: context.eid, config_type: 1, config: cfg.clone() }];

    set_config_with_auth(&context, &oapp, &oapp, &message_lib, &params);

    // Assert config persisted in the message lib via endpoint's get_config passthrough.
    let stored = endpoint_client.get_config(&oapp, &message_lib, &context.eid, &1u32);
    assert_eq!(stored, cfg);
}

// Authorization (caller == delegate(oapp))
#[test]
fn test_set_config_allows_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);

    // Set delegate for the OApp.
    let delegate_option = Some(delegate.clone());
    context.mock_auth(&oapp, "set_delegate", (&oapp, &delegate_option));
    endpoint_client.set_delegate(&oapp, &delegate_option);

    let message_lib = context.setup_mock_message_lib(crate::MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&message_lib);
    let cfg = Bytes::from_slice(env, &[0xAA, 0xBB, 0xCC, 0xDD]);
    let params: Vec<SetConfigParam> =
        vec![env, SetConfigParam { eid: context.eid, config_type: 2, config: cfg.clone() }];

    set_config_with_auth(&context, &delegate, &oapp, &message_lib, &params);

    // Assert config persisted in the message lib via endpoint's get_config passthrough.
    let stored = endpoint_client.get_config(&oapp, &message_lib, &context.eid, &2u32);
    assert_eq!(stored, cfg);
}

// Unauthorized caller is rejected
#[test]
fn test_set_config_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unauthorized = Address::generate(env);
    let message_lib = Address::generate(env);
    let params: Vec<SetConfigParam> = vec![env];

    // Unauthorized should fail before `require_auth()`, so no mock_auth needed.
    let result = endpoint_client.try_set_config(&unauthorized, &oapp, &message_lib, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

// Library must be registered
#[test]
fn test_set_config_requires_registered_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unregistered_lib = Address::generate(env);
    let params: Vec<SetConfigParam> = vec![env];

    // caller == oapp so it passes oapp auth, but should fail `require_registered`.
    context.mock_auth(&oapp, "set_config", (&oapp, &oapp, &unregistered_lib, &params));
    let result = endpoint_client.try_set_config(&oapp, &oapp, &unregistered_lib, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// Multiple params are persisted independently (keyed by eid + config_type)
#[test]
fn test_set_config_multiple_params_persists_each() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let message_lib = context.setup_mock_message_lib(crate::MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&message_lib);

    let cfg_a = Bytes::from_slice(env, &[0x10, 0x11]);
    let cfg_b = Bytes::from_slice(env, &[0x20, 0x21, 0x22]);
    let cfg_c = Bytes::from_slice(env, &[0x30]);

    let params: Vec<SetConfigParam> = vec![
        env,
        SetConfigParam { eid: context.eid, config_type: 7, config: cfg_a.clone() },
        // Same eid, different config_type (should be independent).
        SetConfigParam { eid: context.eid, config_type: 8, config: cfg_c.clone() },
        // Different eid (should be independent).
        SetConfigParam { eid: context.eid + 1, config_type: 8, config: cfg_b.clone() },
    ];

    set_config_with_auth(&context, &oapp, &oapp, &message_lib, &params);

    let stored_a = endpoint_client.get_config(&oapp, &message_lib, &context.eid, &7u32);
    let stored_c = endpoint_client.get_config(&oapp, &message_lib, &context.eid, &8u32);
    let stored_b = endpoint_client.get_config(&oapp, &message_lib, &(context.eid + 1), &8u32);
    assert_eq!(stored_a, cfg_a);
    assert_eq!(stored_c, cfg_c);
    assert_eq!(stored_b, cfg_b);
}

// The set_config overwrites existing config for the same key
#[test]
fn test_set_config_overwrites_existing_config() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let message_lib = context.setup_mock_message_lib(crate::MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&message_lib);

    let cfg_v1 = Bytes::from_slice(env, &[0x01]);
    let cfg_v2 = Bytes::from_slice(env, &[0x02, 0x03]);

    let params_v1: Vec<SetConfigParam> =
        vec![env, SetConfigParam { eid: context.eid, config_type: 9, config: cfg_v1.clone() }];
    set_config_with_auth(&context, &oapp, &oapp, &message_lib, &params_v1);
    assert_eq!(endpoint_client.get_config(&oapp, &message_lib, &context.eid, &9u32), cfg_v1);

    let params_v2: Vec<SetConfigParam> =
        vec![env, SetConfigParam { eid: context.eid, config_type: 9, config: cfg_v2.clone() }];
    set_config_with_auth(&context, &oapp, &oapp, &message_lib, &params_v2);
    assert_eq!(endpoint_client.get_config(&oapp, &message_lib, &context.eid, &9u32), cfg_v2);
}

// Config is isolated per OApp
#[test]
fn test_set_config_isolated_per_oapp() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp_a = Address::generate(env);
    let oapp_b = Address::generate(env);

    let message_lib = context.setup_mock_message_lib(crate::MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&message_lib);

    let cfg_a = Bytes::from_slice(env, &[0xAA]);
    let params: Vec<SetConfigParam> =
        vec![env, SetConfigParam { eid: context.eid, config_type: 42, config: cfg_a.clone() }];

    set_config_with_auth(&context, &oapp_a, &oapp_a, &message_lib, &params);

    // OApp A sees its config.
    assert_eq!(endpoint_client.get_config(&oapp_a, &message_lib, &context.eid, &42u32), cfg_a);
    // OApp B should not see OApp A's config.
    assert_eq!(endpoint_client.get_config(&oapp_b, &message_lib, &context.eid, &42u32), Bytes::new(env));
}
