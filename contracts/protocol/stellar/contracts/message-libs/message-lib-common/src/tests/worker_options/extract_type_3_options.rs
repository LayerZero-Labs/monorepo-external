use crate::worker_options::extract_type_3_options;
use hex_literal::hex;
use soroban_sdk::map;
use soroban_sdk::{Bytes, Env};
use utils::buffer_reader::BufferReader;

#[test]
fn test_extract_type_3_options_returns_empty_for_empty_body() {
    let env = Env::default();

    // Empty body (reader positioned after the 2-byte options type header).
    let body = Bytes::new(&env);
    let mut reader = BufferReader::new(&body);

    let (executor_options, dvn_options) = extract_type_3_options(&env, &mut reader);
    assert_eq!(executor_options.len(), 0);
    assert_eq!(dvn_options, map![&env]);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_extract_type_3_options_splits_executor_and_dvn() {
    let env = Env::default();

    // but without the 2-byte options type prefix.
    let executor_options_raw = hex!("0100110100000000000000000000000000009470010011010000000000000000000000000000ea60");
    let dvn_options_raw = hex!("020002000102000302ff0102000200010200020101");

    let mut body = Bytes::new(&env);
    body.extend_from_slice(&executor_options_raw);
    body.extend_from_slice(&dvn_options_raw);
    let mut reader = BufferReader::new(&body);

    let (executor_options, dvn_options) = extract_type_3_options(&env, &mut reader);

    // Executor option is preserved as-is.
    assert_eq!(executor_options, Bytes::from_slice(&env, &executor_options_raw));

    // DVN options are grouped by dvn_idx (4th byte of the option bytes).
    assert_eq!(dvn_options.len(), 3);
    assert_eq!(dvn_options.get(0).unwrap(), Bytes::from_slice(&env, &hex!("02000200010200020001")));
    assert_eq!(dvn_options.get(1).unwrap(), Bytes::from_slice(&env, &hex!("0200020101")));
    assert_eq!(dvn_options.get(2).unwrap(), Bytes::from_slice(&env, &hex!("02000302ff01")));
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_extract_type_3_options_executor_only_options() {
    let env = Env::default();

    // Two executor options back-to-back.
    let executor_options_raw = hex!("0100110100000000000000000000000000009470010011010000000000000000000000000000ea60");
    let body = Bytes::from_slice(&env, &executor_options_raw);
    let mut reader = BufferReader::new(&body);

    let (executor_options, dvn_options) = extract_type_3_options(&env, &mut reader);

    assert_eq!(executor_options, Bytes::from_slice(&env, &executor_options_raw));
    assert_eq!(dvn_options.len(), 0);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_extract_type_3_options_dvn_only_groups_same_idx_by_concatenation() {
    let env = Env::default();

    // Same DVN test vector as used by `split_worker_options`:
    // - dvn_idx=0 appears twice and should be concatenated.
    let dvn_options_raw = hex!("020002000102000302ff0102000200010200020101");
    let body = Bytes::from_slice(&env, &dvn_options_raw);
    let mut reader = BufferReader::new(&body);

    let (executor_options, dvn_options) = extract_type_3_options(&env, &mut reader);

    assert_eq!(executor_options.len(), 0);
    assert_eq!(dvn_options.len(), 3);
    assert_eq!(dvn_options.get(0).unwrap(), Bytes::from_slice(&env, &hex!("02000200010200020001")));
    assert_eq!(dvn_options.get(1).unwrap(), Bytes::from_slice(&env, &hex!("0200020101")));
    assert_eq!(dvn_options.get(2).unwrap(), Bytes::from_slice(&env, &hex!("02000302ff01")));
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_extract_type_3_options_interleaved_executor_and_dvn_keeps_executor_order() {
    let env = Env::default();

    let exec_1 = hex!("0100110100000000000000000000000000009470");
    let exec_2 = hex!("010011010000000000000000000000000000ea60");
    let dvn_0 = hex!("0200020001");
    let dvn_2 = hex!("02000302ff01");
    let dvn_1 = hex!("0200020101");

    // Interleave DVN and executor options; executor bytes should still be preserved
    // and returned as the concatenation in encounter-order.
    let mut body = Bytes::new(&env);
    body.extend_from_slice(&dvn_0);
    body.extend_from_slice(&exec_1);
    body.extend_from_slice(&dvn_2);
    body.extend_from_slice(&exec_2);
    body.extend_from_slice(&dvn_0);
    body.extend_from_slice(&dvn_1);

    let mut reader = BufferReader::new(&body);
    let (executor_options, dvn_options) = extract_type_3_options(&env, &mut reader);

    let mut expected_executor = Bytes::new(&env);
    expected_executor.extend_from_slice(&exec_1);
    expected_executor.extend_from_slice(&exec_2);
    assert_eq!(executor_options, expected_executor);

    assert_eq!(dvn_options.len(), 3);
    assert_eq!(dvn_options.get(0).unwrap(), Bytes::from_slice(&env, &hex!("02000200010200020001")));
    assert_eq!(dvn_options.get(1).unwrap(), Bytes::from_slice(&env, &hex!("0200020101")));
    assert_eq!(dvn_options.get(2).unwrap(), Bytes::from_slice(&env, &hex!("02000302ff01")));
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1114)")] // WorkerOptionsError::InvalidOptions
fn test_extract_type_3_options_rejects_zero_option_size() {
    let env = Env::default();
    // worker_id = 1 (executor) + option_size = 0 (invalid)
    let body = Bytes::from_slice(&env, &hex!("010000"));
    let mut reader = BufferReader::new(&body);
    extract_type_3_options(&env, &mut reader);
}

#[test]
#[should_panic(expected = "Error(Contract, #1115)")] // WorkerOptionsError::InvalidWorkerId
fn test_extract_type_3_options_rejects_unknown_worker_id() {
    let env = Env::default();
    // worker_id = 0 (invalid) + option_size = 5 + 5 bytes of dummy data
    let body = Bytes::from_slice(&env, &hex!("00000501020304050607"));
    let mut reader = BufferReader::new(&body);
    extract_type_3_options(&env, &mut reader);
}
