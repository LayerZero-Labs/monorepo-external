use crate::codec::oft_msg_codec::{ComposeData, OFTMessage};
use crate::utils::address_payload;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

#[test]
fn test_encode_and_decode_without_compose() {
    let env = Env::default();
    let send_to_addr = BytesN::from_array(&env, &[1u8; 32]);
    let amount_sd_val = 1000u64;

    let msg = OFTMessage { send_to: send_to_addr.clone(), amount_sd: amount_sd_val, compose: None };
    let encoded = msg.encode(&env);

    // Test decode function
    let decoded = OFTMessage::decode(&encoded);
    assert_eq!(decoded.send_to, send_to_addr);
    assert_eq!(decoded.amount_sd, amount_sd_val);
    assert!(decoded.compose.is_none());
}

#[test]
fn test_encode_and_decode_with_compose() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let send_to_addr = BytesN::from_array(&env, &[2u8; 32]);
    let amount_sd_val = 5000u64;
    let compose_msg_val = Bytes::from_array(&env, &[1u8, 2u8, 3u8, 4u8]);

    let msg = OFTMessage {
        send_to: send_to_addr.clone(),
        amount_sd: amount_sd_val,
        compose: Some(ComposeData { from: address_payload(&env, &sender), msg: compose_msg_val }),
    };
    let encoded = msg.encode(&env);

    // Test decode function
    let decoded = OFTMessage::decode(&encoded);
    assert_eq!(decoded.send_to, send_to_addr);
    assert_eq!(decoded.amount_sd, amount_sd_val);
    let compose = decoded.compose.as_ref().unwrap();
    assert_eq!(compose.msg.len(), 4);

    // Verify compose message structure: sender's bytes32 (32 bytes) + compose_msg (4 bytes)
    let compose_from_len = compose.from.to_array().len() as u32;
    let compose_msg_len = compose.msg.len();
    assert_eq!(compose_from_len + compose_msg_len, 36);
}

#[test]
#[should_panic]
fn test_decode_panic_on_empty_data() {
    let env = Env::default();
    let data = Bytes::new(&env);
    OFTMessage::decode(&data);
}

#[test]
#[should_panic]
fn test_decode_panic_on_insufficient_data() {
    let env = Env::default();
    let mut data = Bytes::new(&env);
    data.extend_from_array(&[0u8; 20]); // Not enough data for amount_sd
    OFTMessage::decode(&data);
}
