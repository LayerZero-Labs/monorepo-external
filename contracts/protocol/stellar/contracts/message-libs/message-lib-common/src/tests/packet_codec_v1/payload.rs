use super::test_helper::*;
use crate::packet_codec_v1::payload;
use soroban_sdk::{Bytes, Env};

#[test]
fn test_payload_is_guid_plus_message() {
    let env = Env::default();
    let packet = create_test_outbound_packet(&env);

    // - payload(...) returns guid + message
    let payload_result = payload(&env, &packet);

    let mut expected = Bytes::new(&env);
    expected.extend_from_array(&packet.guid.to_array());
    expected.append(&packet.message);

    assert_eq!(payload_result, expected);
}

#[test]
fn test_payload_supports_empty_message() {
    let env = Env::default();
    let packet = create_test_outbound_packet_with_message(&env, Bytes::new(&env));

    let payload_result = payload(&env, &packet);

    let mut expected = Bytes::new(&env);
    expected.extend_from_array(&packet.guid.to_array());
    assert_eq!(payload_result, expected);
}
