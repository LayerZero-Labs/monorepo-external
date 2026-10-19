use endpoint_v2::{MessageLibType, MessageLibVersion, SetConfigParam};
use message_lib_common::packet_codec_v1;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, IntoVal, Vec,
};

use crate::errors::SimpleMessageLibError;

use super::setup::{
    create_contract_receiver, create_packet, create_packet_with_contract_receiver, setup, MockEndpointClient, TestSetup,
};

// ============================================================================
// Quote Tests
// ============================================================================

#[test]
fn test_quote() {
    let TestSetup { env, sml, endpoint, .. } = setup();

    let packet = create_packet(&env);
    let options = Bytes::new(&env);
    let pay_in_zro = false;

    env.mock_auths(&[MockAuth {
        address: &endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &sml.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let fee = sml.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_with_zro_fee() {
    let TestSetup { env, sml, endpoint, .. } = setup();

    let packet = create_packet(&env);
    let options = Bytes::new(&env);
    let pay_in_zro = true;

    env.mock_auths(&[MockAuth {
        address: &endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &sml.address,
            fn_name: "quote",
            args: (&packet, &options, &pay_in_zro).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let fee = sml.quote(&packet, &options, &pay_in_zro);
    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 99);
}

// ============================================================================
// Send Tests
// ============================================================================

#[test]
fn test_send() {
    let TestSetup { env, sml, endpoint, fee_recipient, .. } = setup();

    let packet = create_packet(&env);
    let options = Bytes::new(&env);
    let pay_in_zro = false;

    env.mock_auths(&[MockAuth {
        address: &endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &sml.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let send_result = sml.send(&packet, &options, &pay_in_zro);

    // Verify encoded packet
    assert_eq!(send_result.encoded_packet, packet_codec_v1::encode_packet(&env, &packet));

    // Verify native fee recipient
    assert_eq!(send_result.native_fee_recipients.len(), 1);
    assert_eq!(send_result.zro_fee_recipients.len(), 0);

    let native_recipient = send_result.native_fee_recipients.get(0).unwrap();
    assert_eq!(native_recipient.to, fee_recipient);
    assert_eq!(native_recipient.amount, 100);
}

#[test]
fn test_send_returns_both_fee_recipients_with_zro() {
    let TestSetup { env, sml, endpoint, owner, fee_recipient } = setup();

    // Set up ZRO token
    let zro = env.register_stellar_asset_contract_v2(owner.clone());
    let zro_address = zro.address();
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint.address,
            fn_name: "set_zro",
            args: (&zro_address,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    endpoint.set_zro(&zro_address);

    let packet = create_packet(&env);
    let options = Bytes::new(&env);
    let pay_in_zro = true;

    env.mock_auths(&[MockAuth {
        address: &endpoint.address,
        invoke: &MockAuthInvoke {
            contract: &sml.address,
            fn_name: "send",
            args: (&packet, &options, &pay_in_zro).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let send_result = sml.send(&packet, &options, &pay_in_zro);

    assert_eq!(send_result.native_fee_recipients.len(), 1);
    assert_eq!(send_result.zro_fee_recipients.len(), 1);

    let native_recipient = send_result.native_fee_recipients.get(0).unwrap();
    assert_eq!(native_recipient.to, fee_recipient);
    assert_eq!(native_recipient.amount, 100);

    let zro_recipient = send_result.zro_fee_recipients.get(0).unwrap();
    assert_eq!(zro_recipient.to, fee_recipient);
    assert_eq!(zro_recipient.amount, 99);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_send_requires_endpoint_auth() {
    let TestSetup { env, sml, .. } = setup();

    let packet = create_packet(&env);
    let options = Bytes::new(&env);
    let pay_in_zro = false;

    // `send` requires endpoint auth; without mocks it should panic.
    sml.send(&packet, &options, &pay_in_zro);
}

// ============================================================================
// Admin Setter Tests
// ============================================================================

#[test]
fn test_admin_setters_update_storage() {
    let TestSetup { env, sml, owner, .. } = setup();

    let new_fee_recipient = Address::generate(&env);
    let new_native_fee = 1234i128;
    let new_zro_fee = 5678i128;
    let new_whitelisted = Address::generate(&env);

    env.mock_auths(&[
        MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &sml.address,
                fn_name: "set_fee_recipient",
                args: (&new_fee_recipient,).into_val(&env),
                sub_invokes: &[],
            },
        },
        MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &sml.address,
                fn_name: "set_native_fee",
                args: (&new_native_fee,).into_val(&env),
                sub_invokes: &[],
            },
        },
        MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &sml.address,
                fn_name: "set_zro_fee",
                args: (&new_zro_fee,).into_val(&env),
                sub_invokes: &[],
            },
        },
        MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &sml.address,
                fn_name: "set_whitelisted_caller",
                args: (&new_whitelisted,).into_val(&env),
                sub_invokes: &[],
            },
        },
    ]);

    sml.set_fee_recipient(&new_fee_recipient);
    sml.set_native_fee(&new_native_fee);
    sml.set_zro_fee(&new_zro_fee);
    sml.set_whitelisted_caller(&new_whitelisted);

    assert_eq!(sml.fee_recipient(), new_fee_recipient);
    assert_eq!(sml.native_fee(), new_native_fee);
    assert_eq!(sml.zro_fee(), new_zro_fee);
    assert_eq!(sml.whitelisted_caller(), new_whitelisted);
}

// ============================================================================
// Metadata Tests
// ============================================================================

#[test]
fn test_message_lib_metadata() {
    let TestSetup { sml, fee_recipient, .. } = setup();

    assert!(sml.is_supported_eid(&123u32));
    assert_eq!(sml.message_lib_type(), MessageLibType::SendAndReceive);
    assert_eq!(sml.version(), MessageLibVersion { major: 0, minor: 0, endpoint_version: 2 });

    assert_eq!(sml.fee_recipient(), fee_recipient);
    assert_eq!(sml.native_fee(), 100);
    assert_eq!(sml.zro_fee(), 99);
}

#[test]
fn test_get_config_not_implemented() {
    let TestSetup { env, sml, .. } = setup();

    let oapp = Address::generate(&env);
    let res = sml.try_get_config(&1u32, &oapp, &0u32);
    assert_eq!(res.unwrap_err().unwrap(), SimpleMessageLibError::NotImplemented.into());
}

#[test]
fn test_set_config_not_implemented() {
    let TestSetup { env, sml, .. } = setup();

    let oapp = Address::generate(&env);
    let empty: Vec<SetConfigParam> = Vec::new(&env);
    let res = sml.try_set_config(&oapp, &empty);
    assert_eq!(res.unwrap_err().unwrap(), SimpleMessageLibError::NotImplemented.into());
}

// ============================================================================
// Validate Packet Tests
// ============================================================================

#[test]
fn test_validate_packet_calls_endpoint_verify() {
    let TestSetup { env, sml, owner, endpoint, .. } = setup();

    env.mock_all_auths_allowing_non_root_auth();

    let (receiver_addr, receiver_bytes) = create_contract_receiver(&env);
    let packet = create_packet_with_contract_receiver(&env, receiver_bytes);

    let header_bytes = packet_codec_v1::encode_packet_header(&env, &packet);
    let payload_hash = BytesN::from_array(&env, &[2u8; 32]);

    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &sml.address,
            fn_name: "validate_packet",
            args: (&header_bytes, &payload_hash).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    sml.validate_packet(&header_bytes, &payload_hash);

    let (last_rl, last_origin, last_receiver, last_hash) =
        MockEndpointClient::new(&env, &endpoint.address).last_verify();

    assert_eq!(last_rl, sml.address);
    assert_eq!(last_origin.src_eid, packet.src_eid);
    assert_eq!(last_origin.nonce, packet.nonce);
    assert_eq!(last_receiver, receiver_addr);
    assert_eq!(last_hash, payload_hash);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_validate_packet_requires_whitelisted_caller_auth() {
    let TestSetup { env, sml, .. } = setup();

    let (_, receiver_bytes) = create_contract_receiver(&env);
    let packet = create_packet_with_contract_receiver(&env, receiver_bytes);

    let header_bytes = packet_codec_v1::encode_packet_header(&env, &packet);
    let payload_hash = BytesN::from_array(&env, &[3u8; 32]);

    // No auth mocked => should panic at whitelisted_caller.require_auth().
    sml.validate_packet(&header_bytes, &payload_hash);
}
