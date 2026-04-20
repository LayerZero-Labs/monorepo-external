use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, Vec};

use crate::{
    errors::EndpointError, tests::endpoint_setup::setup, tests::mock::MockMessageLibClient, MessageLibType,
    SetConfigParam,
};

// The get_config requires library to be registered (internal require_registered)
#[test]
fn test_get_config_requires_registered_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unregistered_lib = Address::generate(env);

    let result = endpoint_client.try_get_config(&oapp, &unregistered_lib, &context.eid, &0u32);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// The get_config returns empty bytes for unset keys
#[test]
fn test_get_config_returns_empty_for_unset_key() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let eid = context.eid;
    let config_type = 7u32;

    let message_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, eid]);
    context.register_library_with_auth(&message_lib);

    let stored = endpoint_client.get_config(&oapp, &message_lib, &eid, &config_type);
    assert_eq!(stored, Bytes::new(env));
}

// The get_config forwards (eid, oapp, config_type) correctly into the message lib
#[test]
fn test_get_config_returns_persisted_and_isolated_by_oapp_and_config_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp_a = Address::generate(env);
    let oapp_b = Address::generate(env);

    let eid = context.eid;
    let config_type_a = 1u32;
    let config_type_b = 2u32;

    let message_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, eid]);
    context.register_library_with_auth(&message_lib);

    // Seed config directly into the mock library to keep this test focused on get_config passthrough.
    let lib_client = MockMessageLibClient::new(env, &message_lib);
    let cfg_a = Bytes::from_slice(env, &[0x01, 0x02, 0x03]);
    let params_a: Vec<SetConfigParam> =
        vec![env, SetConfigParam { eid, config_type: config_type_a, config: cfg_a.clone() }];
    lib_client.set_config(&oapp_a, &params_a);

    // Happy path: exact key returns the stored bytes.
    assert_eq!(endpoint_client.get_config(&oapp_a, &message_lib, &eid, &config_type_a), cfg_a);

    // Different config_type returns empty.
    assert_eq!(endpoint_client.get_config(&oapp_a, &message_lib, &eid, &config_type_b), Bytes::new(env));

    // Different OApp returns empty.
    assert_eq!(endpoint_client.get_config(&oapp_b, &message_lib, &eid, &config_type_a), Bytes::new(env));
}

// The get_config is isolated by EID and by library address
#[test]
fn test_get_config_isolated_by_eid_and_lib() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let eid_a = context.eid;
    let eid_b = eid_a + 1;
    let config_type = 1u32;

    let lib_a = context.setup_mock_message_lib(MessageLibType::Send, vec![env, eid_a, eid_b]);
    let lib_b = context.setup_mock_message_lib(MessageLibType::Send, vec![env, eid_a, eid_b]);
    context.register_library_with_auth(&lib_a);
    context.register_library_with_auth(&lib_b);

    // Seed different values into different libs under the same key.
    let cfg_a = Bytes::from_slice(env, &[0xA1]);
    let cfg_b = Bytes::from_slice(env, &[0xB2]);

    let lib_a_client = MockMessageLibClient::new(env, &lib_a);
    let lib_b_client = MockMessageLibClient::new(env, &lib_b);

    let params_a: Vec<SetConfigParam> = vec![env, SetConfigParam { eid: eid_a, config_type, config: cfg_a.clone() }];
    let params_b: Vec<SetConfigParam> = vec![env, SetConfigParam { eid: eid_a, config_type, config: cfg_b.clone() }];
    lib_a_client.set_config(&oapp, &params_a);
    lib_b_client.set_config(&oapp, &params_b);

    assert_eq!(endpoint_client.get_config(&oapp, &lib_a, &eid_a, &config_type), cfg_a);
    assert_eq!(endpoint_client.get_config(&oapp, &lib_b, &eid_a, &config_type), cfg_b);

    // Different EID (unset) returns empty.
    assert_eq!(endpoint_client.get_config(&oapp, &lib_a, &eid_b, &config_type), Bytes::new(env));
}
