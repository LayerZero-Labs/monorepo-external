use super::setup::TestSetup;
use endpoint_v2::Origin;
use executor::NativeDropParams;
use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN, Vec};

// =============================================================================
// execute() tests
// =============================================================================

#[test]
fn test_execute_without_value() {
    let setup = TestSetup::new();
    let mut params = setup.default_execution_params();
    assert_eq!(params.value, 0);
    // Verifies that `origin` is forwarded unchanged (merged from the former `test_execute_with_different_origins`).
    params.origin = Origin { src_eid: 999, sender: BytesN::from_array(&setup.env, &[0xABu8; 32]), nonce: 12345 };

    // Mint tokens to admin to prove transfer is skipped when value == 0
    setup.mint_native(&setup.admin, 100);
    let admin_before = setup.balance_native(&setup.admin);

    setup.mock_lz_receive_auth(&setup.executor, &params);

    setup.executor_helper_client.execute(&setup.executor, &params, &setup.admin);

    // Verify lz_receive was called with correct params
    let record = setup.receiver_client().get_lz_receive();
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.executor, setup.executor);
    assert_eq!(record.origin, params.origin);
    assert_eq!(record.origin.src_eid, 999);
    assert_eq!(record.origin.nonce, 12345);
    assert_eq!(record.guid, params.guid);
    assert_eq!(record.message, params.message);
    assert_eq!(record.extra_data, params.extra_data);
    assert_eq!(record.value, params.value);

    // Verify no token transfer occurred
    assert_eq!(setup.balance_native(&setup.admin), admin_before);
}

#[test]
fn test_execute_with_large_message() {
    let setup = TestSetup::new();
    let mut params = setup.default_execution_params();

    // Create a larger message
    let large_data: [u8; 256] = [0xFFu8; 256];
    params.message = Bytes::from_slice(&setup.env, &large_data);

    setup.mock_lz_receive_auth(&setup.executor, &params);

    setup.executor_helper_client.execute(&setup.executor, &params, &setup.admin);

    let record = setup.receiver_client().get_lz_receive();
    assert!(record.is_some());
    assert_eq!(record.unwrap().message.len(), 256);
}

#[test]
fn test_execute_with_empty_message() {
    let setup = TestSetup::new();
    let mut params = setup.default_execution_params();
    params.message = Bytes::new(&setup.env);
    params.extra_data = Bytes::new(&setup.env);

    setup.mock_lz_receive_auth(&setup.executor, &params);

    setup.executor_helper_client.execute(&setup.executor, &params, &setup.admin);

    let record = setup.receiver_client().get_lz_receive();
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.message.len(), 0);
    assert_eq!(record.extra_data.len(), 0);
}

// =============================================================================
// compose() tests
// =============================================================================

#[test]
fn test_compose_without_value() {
    let setup = TestSetup::new();
    let params = setup.default_compose_params();
    assert_eq!(params.value, 0);

    // Mint tokens to admin to prove transfer is skipped when value == 0
    setup.mint_native(&setup.admin, 100);
    let admin_before = setup.balance_native(&setup.admin);

    setup.mock_lz_compose_auth(&setup.executor, &params);

    setup.executor_helper_client.compose(&setup.executor, &params, &setup.admin);

    // Verify lz_compose was called with correct params
    let record = setup.composer_client().get_lz_compose();
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.executor, setup.executor);
    assert_eq!(record.from, params.from);
    assert_eq!(record.guid, params.guid);
    assert_eq!(record.index, params.index);
    assert_eq!(record.message, params.message);
    assert_eq!(record.extra_data, params.extra_data);
    assert_eq!(record.value, params.value);

    // Verify no token transfer occurred
    assert_eq!(setup.balance_native(&setup.admin), admin_before);
}

#[test]
fn test_compose_with_empty_data() {
    let setup = TestSetup::new();
    let mut params = setup.default_compose_params();
    params.message = Bytes::new(&setup.env);
    params.extra_data = Bytes::new(&setup.env);

    setup.mock_lz_compose_auth(&setup.executor, &params);

    setup.executor_helper_client.compose(&setup.executor, &params, &setup.admin);

    let record = setup.composer_client().get_lz_compose();
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.message.len(), 0);
    assert_eq!(record.extra_data.len(), 0);
}

// =============================================================================
// native_drop() tests
// =============================================================================

#[test]
fn test_native_drop_delegates_to_executor() {
    let setup = TestSetup::new();
    let origin = setup.default_origin();
    let dst_eid = 2u32;
    let oapp = Address::generate(&setup.env);

    let receiver1 = Address::generate(&setup.env);
    let receiver2 = Address::generate(&setup.env);
    let params: Vec<NativeDropParams> = vec![
        &setup.env,
        NativeDropParams { receiver: receiver1.clone(), amount: 10 },
        NativeDropParams { receiver: receiver2.clone(), amount: 20 },
    ];

    setup.mock_native_drop_auth(&setup.executor, &setup.admin, &origin, dst_eid, &oapp, &params);

    setup.executor_helper_client.native_drop(&setup.executor, &setup.admin, &origin, &dst_eid, &oapp, &params);

    // Verify native_drop was called on executor with correct params
    let record = setup.executor_client().get_native_drop();
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.admin, setup.admin);
    assert_eq!(record.origin, origin);
    assert_eq!(record.dst_eid, dst_eid);
    assert_eq!(record.oapp, oapp);
    assert_eq!(record.params.len(), 2);
    assert_eq!(record.params.get(0).unwrap().receiver, receiver1);
    assert_eq!(record.params.get(0).unwrap().amount, 10);
    assert_eq!(record.params.get(1).unwrap().receiver, receiver2);
    assert_eq!(record.params.get(1).unwrap().amount, 20);
}

#[test]
fn test_native_drop_with_empty_params() {
    let setup = TestSetup::new();
    let origin = setup.default_origin();
    let dst_eid = 1u32;
    let oapp = Address::generate(&setup.env);
    let params: Vec<NativeDropParams> = vec![&setup.env];

    setup.mock_native_drop_auth(&setup.executor, &setup.admin, &origin, dst_eid, &oapp, &params);

    setup.executor_helper_client.native_drop(&setup.executor, &setup.admin, &origin, &dst_eid, &oapp, &params);

    let record = setup.executor_client().get_native_drop();
    assert!(record.is_some());
    assert_eq!(record.unwrap().params.len(), 0);
}

// =============================================================================
// execute() with value tests
// =============================================================================

#[test]
fn test_execute_with_value_transfers_tokens() {
    let setup = TestSetup::new();
    let mut params = setup.default_execution_params();
    params.value = 50;

    // Mint tokens to admin (value payer)
    setup.mint_native(&setup.admin, 100);

    let admin_before = setup.balance_native(&setup.admin);
    let executor_before = setup.balance_native(&setup.executor);

    setup.mock_all_auths();
    setup.executor_helper_client.execute(&setup.executor, &params, &setup.admin);

    // Verify token transfer occurred
    assert_eq!(setup.balance_native(&setup.admin), admin_before - 50);
    assert_eq!(setup.balance_native(&setup.executor), executor_before + 50);

    // Verify lz_receive was called with correct value
    let record = setup.receiver_client().get_lz_receive();
    assert!(record.is_some());
    assert_eq!(record.unwrap().value, 50);
}

#[test]
fn test_execute_with_exact_balance_value() {
    let setup = TestSetup::new();
    let mut params = setup.default_execution_params();
    params.value = 100;

    // Mint exactly the amount needed
    setup.mint_native(&setup.admin, 100);

    setup.mock_all_auths();
    setup.executor_helper_client.execute(&setup.executor, &params, &setup.admin);

    // Verify all tokens transferred
    assert_eq!(setup.balance_native(&setup.admin), 0);
    assert_eq!(setup.balance_native(&setup.executor), 100);
}

// =============================================================================
// compose() with value tests
// =============================================================================

#[test]
fn test_compose_with_value_transfers_tokens() {
    let setup = TestSetup::new();
    let mut params = setup.default_compose_params();
    params.value = 75;

    // Mint tokens to admin (value payer)
    setup.mint_native(&setup.admin, 100);

    let admin_before = setup.balance_native(&setup.admin);
    let executor_before = setup.balance_native(&setup.executor);

    setup.mock_all_auths();
    setup.executor_helper_client.compose(&setup.executor, &params, &setup.admin);

    // Verify token transfer occurred
    assert_eq!(setup.balance_native(&setup.admin), admin_before - 75);
    assert_eq!(setup.balance_native(&setup.executor), executor_before + 75);

    // Verify lz_compose was called with correct value
    let record = setup.composer_client().get_lz_compose();
    assert!(record.is_some());
    assert_eq!(record.unwrap().value, 75);
}

// =============================================================================
// lz_receive_alert() tests
// =============================================================================

#[test]
fn test_lz_receive_alert_records_failure() {
    let setup = TestSetup::new();
    let params = setup.default_execution_params();
    let reason = Bytes::from_slice(&setup.env, b"execution failed: out of gas");

    setup.executor_helper_client.lz_receive_alert(&setup.executor, &params, &reason);

    // Verify lz_receive_alert was called on endpoint with correct params
    let record = setup.endpoint_client().get_lz_receive_alert();
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.executor, setup.executor);
    assert_eq!(record.origin, params.origin);
    assert_eq!(record.receiver, params.receiver);
    assert_eq!(record.guid, params.guid);
    assert_eq!(record.gas_limit, params.gas_limit);
    assert_eq!(record.value, params.value);
    assert_eq!(record.message, params.message);
    assert_eq!(record.extra_data, params.extra_data);
    assert_eq!(record.reason, reason);
}

#[test]
fn test_lz_receive_alert_with_empty_reason() {
    let setup = TestSetup::new();
    let params = setup.default_execution_params();
    let reason = Bytes::new(&setup.env);

    setup.executor_helper_client.lz_receive_alert(&setup.executor, &params, &reason);

    let record = setup.endpoint_client().get_lz_receive_alert();
    assert!(record.is_some());
    assert_eq!(record.unwrap().reason.len(), 0);
}

// =============================================================================
// lz_compose_alert() tests
// =============================================================================

#[test]
fn test_lz_compose_alert_records_failure() {
    let setup = TestSetup::new();
    let params = setup.default_compose_params();
    let reason = Bytes::from_slice(&setup.env, b"compose failed: invalid state");

    setup.executor_helper_client.lz_compose_alert(&setup.executor, &params, &reason);

    // Verify lz_compose_alert was called on endpoint with correct params
    let record = setup.endpoint_client().get_lz_compose_alert();
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.executor, setup.executor);
    assert_eq!(record.from, params.from);
    assert_eq!(record.to, params.to);
    assert_eq!(record.guid, params.guid);
    assert_eq!(record.index, params.index);
    assert_eq!(record.gas_limit, params.gas_limit);
    assert_eq!(record.value, params.value);
    assert_eq!(record.message, params.message);
    assert_eq!(record.extra_data, params.extra_data);
    assert_eq!(record.reason, reason);
}

#[test]
fn test_lz_compose_alert_with_empty_reason() {
    let setup = TestSetup::new();
    let params = setup.default_compose_params();
    let reason = Bytes::new(&setup.env);

    setup.executor_helper_client.lz_compose_alert(&setup.executor, &params, &reason);

    let record = setup.endpoint_client().get_lz_compose_alert();
    assert!(record.is_some());
    assert_eq!(record.unwrap().reason.len(), 0);
}

