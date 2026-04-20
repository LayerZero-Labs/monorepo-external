use soroban_sdk::{Bytes, BytesN};

use crate::{tests::endpoint_setup::setup, util::build_payload};

#[test]
fn test_build_payload_basic() {
    let context = setup();
    let env = &context.env;

    let guid = BytesN::from_array(env, &[1u8; 32]);
    let message = Bytes::from_array(env, &[1, 2, 3, 4, 5]);

    let payload = build_payload(env, &guid, &message);

    // Payload should be 32 bytes (guid) + message length
    assert_eq!(payload.len(), 32 + 5);
}

#[test]
fn test_build_payload() {
    let context = setup();
    let env = &context.env;

    // Mirrors with sui

    // Create a guid with 32 periods (ASCII 46 = '.')
    let guid_bytes = [46u8; 32];
    let guid = BytesN::from_array(env, &guid_bytes);

    // Create message with bytes [18, 19, 20]
    let message = Bytes::from_array(env, &[18, 19, 20]);

    let payload = build_payload(env, &guid, &message);

    // Expected payload: 32 bytes of guid + 3 bytes of message
    let expected_bytes: [u8; 35] = [
        46, 46, 46, 46, 46, 46, 46, 46, // guid bytes 0-7
        46, 46, 46, 46, 46, 46, 46, 46, // guid bytes 8-15
        46, 46, 46, 46, 46, 46, 46, 46, // guid bytes 16-23
        46, 46, 46, 46, 46, 46, 46, 46, // guid bytes 24-31 (32 periods)
        18, 19, 20, // message
    ];
    let expected = Bytes::from_array(env, &expected_bytes);

    assert_eq!(payload, expected);
}

#[test]
fn test_build_payload_empty_message() {
    let context = setup();
    let env = &context.env;

    let guid = BytesN::from_array(env, &[1u8; 32]);
    let message = Bytes::new(env);

    let payload = build_payload(env, &guid, &message);

    // Payload should be just the 32 bytes of GUID
    assert_eq!(payload.len(), 32);
}
