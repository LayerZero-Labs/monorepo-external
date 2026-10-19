use hex_literal::hex;
use soroban_sdk::{Bytes, BytesN};

use crate::{tests::endpoint_setup::setup, util::keccak256};

#[test]
fn test_keccak256() {
    let context = setup();
    let env = &context.env;

    // Mirrors with sui

    // keccak256("")
    let empty = Bytes::new(env);
    let empty_hash = keccak256(env, &empty);
    let expected_empty =
        BytesN::from_array(env, &hex!("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"));
    assert_eq!(empty_hash, expected_empty);

    // keccak256("hello world")
    let message = Bytes::from_slice(env, b"hello world");
    let message_hash = keccak256(env, &message);
    let expected_message =
        BytesN::from_array(env, &hex!("47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad"));
    assert_eq!(message_hash, expected_message);
}
