use crate::worker_options::{test, *};
use hex_literal::hex;
use soroban_sdk::{Bytes, BytesN, Env};
use utils::buffer_reader::BufferReader;

#[test]
fn test_append_native_drop_option_encodes_expected_layout() {
    let env = Env::default();

    let receiver = BytesN::from_array(&env, &hex!("000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266"));
    let executor_option = test::append_native_drop_option_for_test(&env, 10_000_000, &receiver);
    let mut reader = BufferReader::new(&executor_option);

    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 49); // option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_NATIVE_DROP); // option_type
    assert_eq!(reader.read_u128(), 10_000_000); // amount
    assert_eq!(reader.read_bytes_n(), receiver); // receiver
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_append_native_drop_option_zero_amount_and_zero_receiver_matches_expected_bytes() {
    let env = Env::default();

    let receiver = BytesN::from_array(&env, &[0u8; 32]);
    let actual = test::append_native_drop_option_for_test(&env, 0, &receiver);

    let mut expected = Bytes::new(&env);
    expected.extend_from_slice(&[EXECUTOR_WORKER_ID]);
    expected.extend_from_slice(&49u16.to_be_bytes());
    expected.extend_from_slice(&[EXECUTOR_OPTION_TYPE_NATIVE_DROP]);
    expected.extend_from_slice(&0u128.to_be_bytes());
    expected.extend_from_slice(&[0u8; 32]);
    assert_eq!(actual, expected);
}

#[test]
fn test_append_native_drop_option_u128_max_amount_matches_expected_bytes() {
    let env = Env::default();

    let receiver = BytesN::from_array(&env, &[0x11u8; 32]);
    let actual = test::append_native_drop_option_for_test(&env, u128::MAX, &receiver);

    let mut expected = Bytes::new(&env);
    expected.extend_from_slice(&[EXECUTOR_WORKER_ID]);
    expected.extend_from_slice(&49u16.to_be_bytes());
    expected.extend_from_slice(&[EXECUTOR_OPTION_TYPE_NATIVE_DROP]);
    expected.extend_from_slice(&u128::MAX.to_be_bytes());
    expected.extend_from_slice(&[0x11u8; 32]);
    assert_eq!(actual, expected);
}

#[test]
fn test_append_native_drop_option_encodes_amount_big_endian() {
    let env = Env::default();

    // Use a non-symmetric value so endianness mistakes are obvious.
    let amount: u128 = 0x0102030405060708090a0b0c0d0e0f10;
    let receiver = BytesN::from_array(&env, &[0u8; 32]);
    let actual = test::append_native_drop_option_for_test(&env, amount, &receiver);

    // [worker_id=01][option_size=0031][option_type=02][amount(16 bytes, big-endian)][receiver(32 bytes)]
    let expected = Bytes::from_slice(
        &env,
        &hex!(
            "01003102\
             0102030405060708090a0b0c0d0e0f10\
             0000000000000000000000000000000000000000000000000000000000000000"
        ),
    );
    assert_eq!(actual, expected);
}
