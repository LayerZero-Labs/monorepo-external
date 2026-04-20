use crate::worker_options::test;
use hex_literal::hex;
use soroban_sdk::{Bytes, BytesN, Env};

#[test]
fn test_left_pad_to_bytes32_pads_left_with_zeros() {
    let env = Env::default();

    let input_20 = Bytes::from_slice(&env, &hex!("f39fd6e51aad88f6f4ce6ab8827279cfffb92266"));
    let out_32 = test::left_pad_to_bytes32_for_test(&env, &input_20);

    assert_eq!(
        out_32,
        BytesN::from_array(&env, &hex!("000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266"))
    );

    let empty = Bytes::new(&env);
    let out_empty = test::left_pad_to_bytes32_for_test(&env, &empty);
    assert_eq!(out_empty, BytesN::from_array(&env, &[0u8; 32]));
}

#[test]
#[should_panic(expected = "Error(Contract, #1110)")] // WorkerOptionsError::InvalidBytesLength
fn test_left_pad_to_bytes32_rejects_len_greater_than_32() {
    let env = Env::default();
    let too_long = Bytes::from_slice(&env, &[0u8; 33]);
    test::left_pad_to_bytes32_for_test(&env, &too_long);
}

#[test]
fn test_left_pad_to_bytes32_len_32_is_unchanged() {
    let env = Env::default();

    let input = Bytes::from_slice(&env, &[0x11u8; 32]);
    let out = test::left_pad_to_bytes32_for_test(&env, &input);
    assert_eq!(out, BytesN::from_array(&env, &[0x11u8; 32]));
}

#[test]
fn test_left_pad_to_bytes32_len_31_pads_single_leading_zero() {
    let env = Env::default();

    let input = Bytes::from_slice(&env, &[0x22u8; 31]);
    let out = test::left_pad_to_bytes32_for_test(&env, &input);
    let mut expected = [0u8; 32];
    expected[1..].fill(0x22);
    assert_eq!(out, BytesN::from_array(&env, &expected));
}
