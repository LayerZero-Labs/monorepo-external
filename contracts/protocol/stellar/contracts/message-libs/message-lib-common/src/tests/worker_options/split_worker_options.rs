use crate::worker_options::*;
use hex_literal::hex;
use soroban_sdk::{Bytes, BytesN, Env};
use utils::buffer_reader::BufferReader;

#[test]
fn test_split_worker_options_type3_dvn_only() {
    let env = Env::default();

    // Type 3, DVN options only.
    // x"0003" + x"020002000102000302ff0102000200010200020101"
    let mut options = Bytes::new(&env);
    options.extend_from_slice(&OPTIONS_TYPE_3.to_be_bytes());
    options.extend_from_slice(&hex!("020002000102000302ff0102000200010200020101"));

    let (executor_options, dvn_options) = split_worker_options(&env, &options);

    assert_eq!(executor_options.len(), 0);
    assert_eq!(dvn_options.len(), 3);

    assert_eq!(dvn_options.get(0).unwrap(), Bytes::from_slice(&env, &hex!("02000200010200020001")));
    assert_eq!(dvn_options.get(1).unwrap(), Bytes::from_slice(&env, &hex!("0200020101")));
    assert_eq!(dvn_options.get(2).unwrap(), Bytes::from_slice(&env, &hex!("02000302ff01")));
}

#[test]
fn test_split_worker_options_type3_executor_only() {
    let env = Env::default();

    // Type 3, executor options only.
    let executor_options_raw = hex!("0100110100000000000000000000000000009470010011010000000000000000000000000000ea60");
    let mut options = Bytes::new(&env);
    options.extend_from_slice(&OPTIONS_TYPE_3.to_be_bytes());
    options.extend_from_slice(&executor_options_raw);

    let (executor_options, dvn_options) = split_worker_options(&env, &options);

    assert_eq!(executor_options, Bytes::from_slice(&env, &executor_options_raw));
    assert_eq!(dvn_options.len(), 0);
}

#[test]
fn test_split_worker_options_type3_executor_and_dvn() {
    let env = Env::default();

    // Type 3, executor + DVN options.
    let executor_options_raw = hex!("0100110100000000000000000000000000009470010011010000000000000000000000000000ea60");
    let dvn_options_raw = hex!("020002000102000302ff0102000200010200020101");

    let mut options = Bytes::new(&env);
    options.extend_from_slice(&OPTIONS_TYPE_3.to_be_bytes());
    options.extend_from_slice(&executor_options_raw);
    options.extend_from_slice(&dvn_options_raw);

    let (executor_options, dvn_options) = split_worker_options(&env, &options);

    assert_eq!(executor_options, Bytes::from_slice(&env, &executor_options_raw));
    assert_eq!(dvn_options.len(), 3);

    assert_eq!(dvn_options.get(0).unwrap(), Bytes::from_slice(&env, &hex!("02000200010200020001")));
    assert_eq!(dvn_options.get(1).unwrap(), Bytes::from_slice(&env, &hex!("0200020101")));
    assert_eq!(dvn_options.get(2).unwrap(), Bytes::from_slice(&env, &hex!("02000302ff01")));
}

#[test]
fn test_split_worker_options_legacy_type1_converts_to_executor_options() {
    let env = Env::default();

    // Legacy type 1: [type][gas(u256)].
    let mut options = Bytes::new(&env);
    options.extend_from_slice(&LEGACY_OPTIONS_TYPE_1.to_be_bytes());
    options.extend_from_slice(&hex!("0000000000000000000000000000000000000000000000000000000000030d40")); // 200_000

    let (executor_options, dvn_options) = split_worker_options(&env, &options);

    assert_eq!(executor_options, Bytes::from_slice(&env, &hex!("0100110100000000000000000000000000030d40")));
    assert_eq!(dvn_options.len(), 0);

    let mut reader = BufferReader::new(&executor_options);
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 17); // option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE); // option_type
    assert_eq!(reader.read_u128(), 200000); // option_data
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_split_worker_options_legacy_type2_converts_to_executor_options() {
    let env = Env::default();

    // Legacy type 2: [type][gas(u256)][amount(u256)][receiver(20 bytes)].
    let mut legacy_options = Bytes::new(&env);
    legacy_options.extend_from_slice(&LEGACY_OPTIONS_TYPE_2.to_be_bytes());
    legacy_options.extend_from_slice(&hex!(
        "0000000000000000000000000000000000000000000000000000000000030d40\
         0000000000000000000000000000000000000000000000000000000000989680\
         f39fd6e51aad88f6f4ce6ab8827279cfffb92266"
    ));

    let expected_executor_options = Bytes::from_slice(&env, &hex!("0100110100000000000000000000000000030d400100310200000000000000000000000000989680000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266"));

    let (executor_options, dvn_options) = split_worker_options(&env, &legacy_options);
    assert_eq!(dvn_options.len(), 0);
    assert_eq!(executor_options, expected_executor_options);

    let mut reader = BufferReader::new(&executor_options);
    // lzReceive
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 17); // option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE); // option_type
    assert_eq!(reader.read_u128(), 200000); // option value (execution gas)
                                            // nativeDrop
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 49); //option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_NATIVE_DROP); // option_type
    assert_eq!(reader.read_u128(), 10000000); // option value (amount)
    assert_eq!(
        reader.read_bytes_n(),
        BytesN::from_array(&env, &hex!("000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266"))
    ); // option value (receiver)
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1114)")] // WorkerOptionsError::InvalidOptions
fn test_split_worker_options_rejects_too_short_options() {
    let env = Env::default();
    let mut options = Bytes::new(&env);
    options.push_back(OPTIONS_TYPE_3 as u8);
    split_worker_options(&env, &options);
}

#[test]
#[should_panic(expected = "Error(Contract, #1114)")] // WorkerOptionsError::InvalidOptions
fn test_split_worker_options_rejects_empty_options() {
    let env = Env::default();
    let options = Bytes::new(&env);
    split_worker_options(&env, &options);
}
