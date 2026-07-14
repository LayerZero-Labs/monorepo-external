//! Tests for the OApp Message Inspector feature.

use crate::tests::test_utils::{create_send_param, OFTTestSetup};
use common_macros::contract_error;
use endpoint_v2::MessagingFee;
use oapp::IOAppMsgInspector;
use soroban_sdk::{
    contract, contractimpl, panic_with_error,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal,
};

// ==================== Mock Inspector Contracts ====================

/// A mock inspector that always passes (does nothing)
#[contract]
pub struct PassingInspector;

#[contractimpl]
impl IOAppMsgInspector for PassingInspector {
    fn inspect(_env: &Env, _oapp: &Address, _message: &Bytes, _options: &Bytes) -> bool {
        // Do nothing - inspection passes
        true
    }
}

#[contract_error]
pub enum InspectorError {
    InspectionFailed = 1,
}

/// A mock inspector that always fails (panics)
#[contract]
pub struct FailingInspector;

#[contractimpl]
impl IOAppMsgInspector for FailingInspector {
    fn inspect(env: &Env, _oapp: &Address, _message: &Bytes, _options: &Bytes) -> bool {
        panic_with_error!(env, InspectorError::InspectionFailed);
    }
}

// ==================== Storage Tests ====================

#[test]
fn test_msg_inspector_not_set_by_default() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // msg_inspector should be None by default
    let inspector = setup.oft.msg_inspector();
    assert_eq!(inspector, None);
}

#[test]
fn test_set_msg_inspector() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Deploy a passing inspector
    let inspector_address = env.register(PassingInspector, ());

    // Owner (authorizer) sets the inspector
    env.mock_auths(&[MockAuth {
        address: &setup.owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&Some(inspector_address.clone()), &setup.owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.set_msg_inspector(&Some(inspector_address.clone()), &setup.owner);

    // Verify inspector is set
    let stored_inspector = setup.oft.msg_inspector();
    assert_eq!(stored_inspector, Some(inspector_address));
}

#[test]
fn test_remove_msg_inspector() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Deploy and set a passing inspector first
    let inspector_address = env.register(PassingInspector, ());

    env.mock_auths(&[MockAuth {
        address: &setup.owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&Some(inspector_address.clone()), &setup.owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.set_msg_inspector(&Some(inspector_address), &setup.owner);

    // Verify it's set
    assert!(setup.oft.msg_inspector().is_some());

    // Remove the inspector by setting to None
    env.mock_auths(&[MockAuth {
        address: &setup.owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&None::<Address>, &setup.owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.set_msg_inspector(&None, &setup.owner);

    // Verify inspector is removed
    let stored_inspector = setup.oft.msg_inspector();
    assert_eq!(stored_inspector, None);
}

// ==================== Access Control Tests ====================

#[test]
#[should_panic(expected = "Error(Contract, #1086)")] // RbacError::Unauthorized
fn test_set_msg_inspector_requires_owner() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Deploy a passing inspector
    let inspector_address = env.register(PassingInspector, ());

    // Non-owner (not the authorizer) tries to set the inspector
    let non_owner = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &non_owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&Some(inspector_address.clone()), &non_owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    // This should panic because non_owner is not the authorizer
    setup.oft.set_msg_inspector(&Some(inspector_address), &non_owner);
}

// ==================== Integration Tests with Send ====================

#[test]
fn test_send_without_inspector_succeeds() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    // Send without inspector set - should succeed
    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &oft_receipt);

    assert!(msg_receipt.nonce > 0);
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
}

#[test]
fn test_send_with_passing_inspector() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Deploy and set a passing inspector
    let inspector_address = env.register(PassingInspector, ());
    env.mock_auths(&[MockAuth {
        address: &setup.owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&Some(inspector_address.clone()), &setup.owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.set_msg_inspector(&Some(inspector_address), &setup.owner);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    // Send with passing inspector - should succeed
    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &oft_receipt);

    assert!(msg_receipt.nonce > 0);
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
}

#[test]
fn test_send_with_failing_inspector() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Deploy and set a failing inspector
    let inspector_address = env.register(FailingInspector, ());
    env.mock_auths(&[MockAuth {
        address: &setup.owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&Some(inspector_address.clone()), &setup.owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.set_msg_inspector(&Some(inspector_address), &setup.owner);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    // Send with failing inspector - should fail
    let result = setup.try_send(&sender, &send_param, &fee, &sender, &oft_receipt);

    // Verify the send failed due to inspector
    assert!(result.is_err() || result.unwrap().is_err());
}

// ==================== Integration Tests with Quote ====================

#[test]
fn test_quote_send_with_passing_inspector() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Deploy and set a passing inspector
    let inspector_address = env.register(PassingInspector, ());
    env.mock_auths(&[MockAuth {
        address: &setup.owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&Some(inspector_address.clone()), &setup.owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.set_msg_inspector(&Some(inspector_address), &setup.owner);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);

    // Quote with passing inspector - should succeed
    let fee = setup.oft.quote_send(&sender, &send_param, &false);

    assert!(fee.native_fee > 0);
}

#[test]
fn test_quote_send_with_failing_inspector() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Deploy and set a failing inspector
    let inspector_address = env.register(FailingInspector, ());
    env.mock_auths(&[MockAuth {
        address: &setup.owner,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "set_msg_inspector",
            args: (&Some(inspector_address.clone()), &setup.owner).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.set_msg_inspector(&Some(inspector_address), &setup.owner);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);

    // Quote with failing inspector - should fail
    let result = setup.oft.try_quote_send(&sender, &send_param, &false);

    // Verify the quote failed due to inspector
    assert!(result.is_err());
}
