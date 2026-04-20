//! Unit tests for BlockedMessageLib.

use endpoint_v2::{MessageLibType, MessageLibVersion, SetConfigParam};
use soroban_sdk::{testutils::Address as _, Address, Bytes, Vec};

use super::setup::{create_packet, setup};
use crate::BlockedMessageLibError;

// ============================================================================
// IMessageLib Tests
// ============================================================================

#[test]
fn is_supported_eid_returns_true_for_any_eid() {
    let test = setup();

    assert!(test.client.is_supported_eid(&0u32));
    assert!(test.client.is_supported_eid(&12345u32));
    assert!(test.client.is_supported_eid(&u32::MAX));
}

#[test]
fn version_returns_max_values() {
    let test = setup();

    assert_eq!(
        test.client.version(),
        MessageLibVersion { major: u64::MAX, minor: u8::MAX as u32, endpoint_version: 2 }
    );
}

#[test]
fn message_lib_type_returns_send_and_receive() {
    let test = setup();

    let lib_type = test.client.message_lib_type();

    assert_eq!(lib_type, MessageLibType::SendAndReceive);
}

#[test]
fn set_config_panics() {
    let test = setup();
    let oapp = Address::generate(&test.env);
    let params: Vec<SetConfigParam> = Vec::new(&test.env);

    let result = test.client.try_set_config(&oapp, &params);

    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());
}

#[test]
fn get_config_panics() {
    let test = setup();
    let oapp = Address::generate(&test.env);

    let result = test.client.try_get_config(&1u32, &oapp, &0u32);

    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());
}

// ============================================================================
// ISendLib Tests
// ============================================================================

#[test]
fn quote_panics() {
    let test = setup();
    let packet = create_packet(&test.env);
    let options = Bytes::new(&test.env);

    let result = test.client.try_quote(&packet, &options, &false);

    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());
}

#[test]
fn quote_panics_with_zro() {
    let test = setup();
    let packet = create_packet(&test.env);
    let options = Bytes::new(&test.env);

    let result = test.client.try_quote(&packet, &options, &true);

    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());
}

#[test]
fn send_panics() {
    let test = setup();
    let packet = create_packet(&test.env);
    let options = Bytes::new(&test.env);

    let result = test.client.try_send(&packet, &options, &false);

    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());
}

#[test]
fn send_panics_with_zro() {
    let test = setup();
    let packet = create_packet(&test.env);
    let options = Bytes::new(&test.env);

    let result = test.client.try_send(&packet, &options, &true);

    assert_eq!(result.unwrap_err().unwrap(), BlockedMessageLibError::NotImplemented.into());
}
