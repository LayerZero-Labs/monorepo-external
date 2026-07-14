use crate::codec::oft_compose_msg_codec::OFTComposeMsg;
use soroban_sdk::{Bytes, BytesN, Env};

#[test]
fn test_encode_and_decode_basic() {
    let env = Env::default();
    let nonce = 12345u64;
    let src_eid = 101u32;
    let amount_ld = 1_000_000_000i128; // 1 token with 9 decimals
    let compose_from = BytesN::from_array(&env, &[0x42u8; 32]);
    let compose_msg = Bytes::from_array(&env, b"test compose message");

    let msg = OFTComposeMsg {
        nonce,
        src_eid,
        amount_ld,
        compose_from: compose_from.clone(),
        compose_msg: compose_msg.clone(),
    };

    let encoded = msg.encode(&env);
    let decoded = OFTComposeMsg::decode(&encoded);

    assert_eq!(decoded.nonce, nonce);
    assert_eq!(decoded.src_eid, src_eid);
    assert_eq!(decoded.amount_ld, amount_ld);
    assert_eq!(decoded.compose_from, compose_from);
    assert_eq!(decoded.compose_msg, compose_msg);
}

#[test]
fn test_encode_with_empty_compose_msg() {
    let env = Env::default();
    let nonce = 123u64;
    let src_eid = 1u32;
    let amount_ld = 1_000_000i128;
    let compose_from = BytesN::from_array(&env, &[0x11u8; 32]);
    let compose_msg = Bytes::new(&env); // Empty

    let msg = OFTComposeMsg { nonce, src_eid, amount_ld, compose_from: compose_from.clone(), compose_msg };

    let encoded = msg.encode(&env);
    let decoded = OFTComposeMsg::decode(&encoded);

    assert_eq!(decoded.nonce, nonce);
    assert_eq!(decoded.src_eid, src_eid);
    assert_eq!(decoded.amount_ld, amount_ld);
    assert_eq!(decoded.compose_from, compose_from);
    assert_eq!(decoded.compose_msg.len(), 0);
}

#[test]
#[should_panic]
fn test_decode_panic_on_empty_data() {
    let env = Env::default();
    let data = Bytes::new(&env);
    OFTComposeMsg::decode(&data);
}

#[test]
#[should_panic]
fn test_decode_panic_on_insufficient_data() {
    let env = Env::default();
    let mut data = Bytes::new(&env);
    // Only 30 bytes - not enough for nonce(8) + src_eid(4) + amount_ld(16) + compose_from(32) = 60 bytes minimum
    data.extend_from_array(&[0u8; 30]);
    OFTComposeMsg::decode(&data);
}
