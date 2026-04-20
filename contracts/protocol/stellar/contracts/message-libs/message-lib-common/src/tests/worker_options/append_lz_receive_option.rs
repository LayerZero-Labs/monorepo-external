use crate::worker_options::{test, *};
use hex_literal::hex;
use soroban_sdk::{Bytes, Env};
use utils::buffer_reader::BufferReader;

#[test]
fn test_append_lz_receive_option_encodes_expected_layout() {
    let env = Env::default();

    let executor_option = test::append_lz_receive_option_for_test(&env, 200_000);
    let mut reader = BufferReader::new(&executor_option);

    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 17); // option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE); // option_type
    assert_eq!(reader.read_u128(), 200_000); // execution gas
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_append_lz_receive_option_zero_gas_matches_expected_bytes() {
    let env = Env::default();

    let actual = test::append_lz_receive_option_for_test(&env, 0);
    let expected = Bytes::from_slice(&env, &hex!("0100110100000000000000000000000000000000"));
    assert_eq!(actual, expected);
}

#[test]
fn test_append_lz_receive_option_u128_max_gas_matches_expected_bytes() {
    let env = Env::default();

    let actual = test::append_lz_receive_option_for_test(&env, u128::MAX);
    let expected = Bytes::from_slice(&env, &hex!("01001101ffffffffffffffffffffffffffffffff"));
    assert_eq!(actual, expected);
}

#[test]
fn test_append_lz_receive_option_encodes_gas_big_endian() {
    let env = Env::default();

    // Use a non-symmetric value so endianness mistakes are obvious.
    let execution_gas: u128 = 0x0102030405060708090a0b0c0d0e0f10;
    let actual = test::append_lz_receive_option_for_test(&env, execution_gas);

    // [worker_id=01][option_size=0011][option_type=01][gas(16 bytes, big-endian)]
    let expected = Bytes::from_slice(&env, &hex!("010011010102030405060708090a0b0c0d0e0f10"));
    assert_eq!(actual, expected);
}
