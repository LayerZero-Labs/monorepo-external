//! DVN tests

use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::workers::access_control::{
    ADMIN_ROLE, ALLOW_LIST_ROLE, DEFAULT_ADMIN_ROLE, DENY_LIST_ROLE, MESSAGE_LIB_ROLE,
};
use layerzero::workers::base::errors::{err_role_renouncing_disabled, err_sender_not_allowed};
use layerzero::workers::base::interface::IWorkerBaseDispatcherTrait;
use layerzero::workers::dvn::dvn::Dvn;
use layerzero::workers::dvn::interface::{IDvnDispatcherTrait, IDvnSafeDispatcherTrait};
use layerzero::workers::dvn::structs::{DstConfig, ExecuteParam, SetDstConfigParams};
use layerzero::workers::dvn::{errors, events};
use layerzero::workers::interface::{
    ILayerZeroWorkerDispatcher, ILayerZeroWorkerDispatcherTrait,
    ILayerZeroWorkerSafeDispatcherTrait,
};
use multisig::MultisigComponent;
use multisig::errors::{err_only_multisig, err_signature_error};
use multisig::events::{SignerSet, ThresholdSet};
use multisig::interface::{IMultisigDispatcher, IMultisigDispatcherTrait};
use openzeppelin::access::accesscontrol::AccessControlComponent;
use openzeppelin::access::accesscontrol::interface::{
    IAccessControlDispatcherTrait, IAccessControlSafeDispatcherTrait,
};
use snforge_std::fuzzable::{FuzzableU16, FuzzableU32, FuzzableU64};
use snforge_std::{
    DeclareResultTrait, EventSpyAssertionsTrait, EventSpyTrait, declare, get_class_hash, spy_events,
    start_cheat_block_timestamp, start_cheat_caller_address, start_mock_call,
    stop_cheat_block_timestamp, stop_cheat_caller_address,
};
use starknet::account::Call;
use starknet::{ContractAddress, EthAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::constants::assert_eq;
use crate::fuzzable::contract_address::{
    ContractAddressArrayList, FuzzableContractAddress, FuzzableContractAddresses,
};
use crate::fuzzable::dst_config::FuzzableDvnDstConfig;
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::eth_address::FuzzableEthAddress;
use crate::fuzzable::expiry::{Expiry, FuzzableExpiry};
use crate::fuzzable::felt_array::{Felt252ArrayList, FuzzableFelt252Array};
use crate::fuzzable::keys::FuzzableKeyPair;
use crate::mocks::workers::dvn::MockDVN;
use crate::workers::dvn::utils::{
    DvnDeploy, KeyPair, build_signatures, create_mock_quote_params, deploy_dvn,
    deploy_dvn_with_access_control_lists, deploy_dvn_with_additional_roles, sign_for_test_k1,
};

/// Default multiplier basis points (120%)
const DEFAULT_MULTIPLIER_BPS: u16 = 12000;

// Test addresses
const PRICE_FEED: ContractAddress = 'price_feed'.try_into().unwrap();
const WORKER_FEE_LIB: ContractAddress = 'worker_fee_lib'.try_into().unwrap();

// Test values
const DST_EID: u32 = 1;
const VID: u32 = 1;
const MOCK_FEE: u256 = 1000;

//////////////////////////
// Access control tests //
//////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn access_control_initial_roles_set_correctly(
    vid: u32, message_libs: ContractAddressArrayList, admins: ContractAddressArrayList,
) {
    let DvnDeploy {
        access_control, dispatcher, ..,
    } = deploy_dvn(message_libs.arr.span(), vid, admins.arr.span());

    // Check that admin roles were set correctly
    for admin in admins.arr {
        assert!(access_control.has_role(ADMIN_ROLE, admin));
        assert!(!access_control.has_role(MESSAGE_LIB_ROLE, admin));
        assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, admin));
        assert!(!access_control.has_role(ALLOW_LIST_ROLE, admin));
        assert!(!access_control.has_role(DENY_LIST_ROLE, admin));
    }

    // Check that message lib roles were set correctly
    for msg_lib in message_libs.arr {
        assert!(access_control.has_role(MESSAGE_LIB_ROLE, msg_lib));
        assert!(!access_control.has_role(ADMIN_ROLE, msg_lib));
        assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, msg_lib));
        assert!(!access_control.has_role(ALLOW_LIST_ROLE, msg_lib));
        assert!(!access_control.has_role(DENY_LIST_ROLE, msg_lib));
    }

    // Check that the VID was set correctly
    assert(dispatcher.get_vid() == vid, 'VID should be set');
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_admins_grant_admin_roles(
    admin: ContractAddress, new_admin: ContractAddress, vid: u32,
) {
    let DvnDeploy {
        dvn, access_control, ..,
    } = deploy_dvn(array![].span(), vid, array![admin].span());

    // Admins can grant admin roles
    cheat_caller_address_once(dvn, admin);
    access_control.grant_role(ADMIN_ROLE, new_admin);

    // Check that new_admin only has the admin role
    assert!(access_control.has_role(ADMIN_ROLE, new_admin));
    assert!(!access_control.has_role(MESSAGE_LIB_ROLE, new_admin));
    assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, new_admin));
    assert!(!access_control.has_role(ALLOW_LIST_ROLE, new_admin));
    assert!(!access_control.has_role(DENY_LIST_ROLE, new_admin));
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_multisig_grants_message_lib_role(
    msg_lib: ContractAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
    admin: ContractAddress,
) {
    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let expiration: u256 = expiry.expiry.into();
    let DvnDeploy {
        dvn, access_control, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    // Sign a call to grant message lib role
    let call_data = Call {
        to: dvn,
        selector: selector!("grant_role"),
        calldata: array![MESSAGE_LIB_ROLE, msg_lib.into()].span(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that msg_lib only has the message lib role
    assert!(access_control.has_role(MESSAGE_LIB_ROLE, msg_lib));
    assert!(!access_control.has_role(ADMIN_ROLE, msg_lib));
    assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, msg_lib));
    assert!(!access_control.has_role(ALLOW_LIST_ROLE, msg_lib));
    assert!(!access_control.has_role(DENY_LIST_ROLE, msg_lib));
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_multisig_grants_allow_list_role(
    allow_address: ContractAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
    admin: ContractAddress,
) {
    let DvnDeploy {
        dvn, access_control, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(),
            vid,
            array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()],
            array![admin].span(),
            array![].span(),
            array![].span(),
        );
    let expiration: u256 = expiry.expiry.into();
    let call_data = Call {
        to: dvn,
        selector: selector!("grant_role"),
        calldata: array![ALLOW_LIST_ROLE, allow_address.into()].span(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that allow_address only has the allow list role
    assert!(access_control.has_role(ALLOW_LIST_ROLE, allow_address));
    assert!(!access_control.has_role(DENY_LIST_ROLE, allow_address));
    assert!(!access_control.has_role(ADMIN_ROLE, allow_address));
    assert!(!access_control.has_role(MESSAGE_LIB_ROLE, allow_address));
    assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, allow_address));
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_multisig_grants_deny_list_role(
    deny_address: ContractAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
    admin: ContractAddress,
) {
    let DvnDeploy {
        dvn, access_control, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(),
            vid,
            array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()],
            array![admin].span(),
            array![].span(),
            array![].span(),
        );
    let expiration: u256 = expiry.expiry.into();
    let call_data = Call {
        to: dvn,
        selector: selector!("grant_role"),
        calldata: array![DENY_LIST_ROLE, deny_address.into()].span(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that msg_lib only has the message lib role
    assert!(access_control.has_role(DENY_LIST_ROLE, deny_address));
    assert!(!access_control.has_role(ALLOW_LIST_ROLE, deny_address));
    assert!(!access_control.has_role(ADMIN_ROLE, deny_address));
    assert!(!access_control.has_role(MESSAGE_LIB_ROLE, deny_address));
    assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, deny_address));
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_admin_cannot_grant_nonadmin_roles(
    admin: ContractAddress, address: ContractAddress, vid: u32,
) {
    let DvnDeploy {
        dvn, access_control, safe_access_control, ..,
    } = deploy_dvn(array![].span(), vid, array![admin].span());

    // Ensure admin is not the DVN contract itself
    assert_ne!(admin, dvn);

    start_cheat_caller_address(dvn, admin);

    // Admin cannot grant message lib role
    let res = safe_access_control.grant_role(MESSAGE_LIB_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!access_control.has_role(MESSAGE_LIB_ROLE, address));

    // Admin cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!access_control.has_role(ALLOW_LIST_ROLE, address));

    // Admin cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!access_control.has_role(DENY_LIST_ROLE, address));

    // Admin cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, address);
    assert_panic_with_error(res, errors::err_invalid_role(DEFAULT_ADMIN_ROLE));
    assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, address));
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_message_lib_cannot_grant_roles(
    msg_lib: ContractAddress, address: ContractAddress, vid: u32,
) {
    let DvnDeploy {
        dvn, access_control, safe_access_control, ..,
    } = deploy_dvn(array![msg_lib].span(), vid, array![].span());

    // Ensure msg_lib is not the DVN contract itself
    assert_ne!(msg_lib, dvn);

    start_cheat_caller_address(dvn, msg_lib);

    // Message lib cannot grant admin role
    let res = safe_access_control.grant_role(ADMIN_ROLE, address);
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
    assert!(!access_control.has_role(ADMIN_ROLE, address));

    // Message lib cannot grant message lib role
    let res = safe_access_control.grant_role(MESSAGE_LIB_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!access_control.has_role(MESSAGE_LIB_ROLE, address));

    // Message lib cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!access_control.has_role(ALLOW_LIST_ROLE, address));

    // Message lib cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!access_control.has_role(DENY_LIST_ROLE, address));

    // Message lib cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, address);
    assert_panic_with_error(res, errors::err_invalid_role(DEFAULT_ADMIN_ROLE));
    assert!(!access_control.has_role(DEFAULT_ADMIN_ROLE, address));
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_allow_list_cannot_grant_roles(
    allow_address: ContractAddress, address: ContractAddress, vid: u32,
) {
    let DvnDeploy {
        dvn, safe_access_control, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![].span(),
            vid,
            ZERO_ADDRESS,
            array![].span(),
            array![allow_address].span(),
            array![].span(),
        );

    // Ensure allow_address is not the DVN contract itself
    assert_ne!(allow_address, dvn);

    start_cheat_caller_address(dvn, allow_address);

    // Allow address cannot grant admin role
    let res = safe_access_control.grant_role(ADMIN_ROLE, address);
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
    assert!(!safe_access_control.has_role(ADMIN_ROLE, address).unwrap());

    // Allow address cannot grant message lib role
    let res = safe_access_control.grant_role(MESSAGE_LIB_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!safe_access_control.has_role(MESSAGE_LIB_ROLE, address).unwrap());

    // Allow address cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!safe_access_control.has_role(ALLOW_LIST_ROLE, address).unwrap());

    // Allow address cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!safe_access_control.has_role(DENY_LIST_ROLE, address).unwrap());

    // Allow address cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, address);
    assert_panic_with_error(res, errors::err_invalid_role(DEFAULT_ADMIN_ROLE));
    assert!(!safe_access_control.has_role(DEFAULT_ADMIN_ROLE, address).unwrap());
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_deny_list_cannot_grant_roles(
    deny_address: ContractAddress, address: ContractAddress, vid: u32,
) {
    let DvnDeploy {
        dvn, safe_access_control, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![].span(),
            vid,
            ZERO_ADDRESS,
            array![].span(),
            array![].span(),
            array![deny_address].span(),
        );

    // Ensure deny_address is not the DVN contract itself
    assert_ne!(deny_address, dvn);

    start_cheat_caller_address(dvn, deny_address);

    // Deny address cannot grant admin role
    let res = safe_access_control.grant_role(ADMIN_ROLE, address);
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
    assert!(!safe_access_control.has_role(ADMIN_ROLE, address).unwrap());

    // Deny address cannot grant message lib role
    let res = safe_access_control.grant_role(MESSAGE_LIB_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!safe_access_control.has_role(MESSAGE_LIB_ROLE, address).unwrap());

    // Deny address cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!safe_access_control.has_role(ALLOW_LIST_ROLE, address).unwrap());

    // Deny address cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, address);
    assert_panic_with_error(res, err_only_multisig());
    assert!(!safe_access_control.has_role(DENY_LIST_ROLE, address).unwrap());

    // Deny address cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, address);
    assert_panic_with_error(res, errors::err_invalid_role(DEFAULT_ADMIN_ROLE));
    assert!(!safe_access_control.has_role(DEFAULT_ADMIN_ROLE, address).unwrap());
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_default_admin_is_role_admin_for_all_roles(vid: u32) {
    let DvnDeploy { access_control, .. } = deploy_dvn(array![].span(), vid, array![].span());
    assert_eq(access_control.get_role_admin(DEFAULT_ADMIN_ROLE), DEFAULT_ADMIN_ROLE);
    assert_eq(access_control.get_role_admin(ADMIN_ROLE), DEFAULT_ADMIN_ROLE);
    assert_eq(access_control.get_role_admin(MESSAGE_LIB_ROLE), DEFAULT_ADMIN_ROLE);
    assert_eq(access_control.get_role_admin(ALLOW_LIST_ROLE), DEFAULT_ADMIN_ROLE);
    assert_eq(access_control.get_role_admin(DENY_LIST_ROLE), DEFAULT_ADMIN_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_allow_list_is_managed_correctly(allow_list: ContractAddressArrayList) {
    let DvnDeploy {
        dvn, access_control, base_worker, ..,
    } = deploy_dvn(array![].span(), VID, array![].span());

    // Check adding allowed addresses to allow list
    let mut allow_list_len = 0;
    for allowed_address in @allow_list.arr {
        cheat_caller_address_once(dvn, dvn);
        access_control.grant_role(ALLOW_LIST_ROLE, *allowed_address);
        allow_list_len += 1;

        assert_eq(base_worker.get_allow_list_size(), allow_list_len);
    }

    assert_eq(base_worker.get_allow_list_size(), allow_list.arr.len().into());

    // Check removing addresses from allow list
    for allowed_address in allow_list.arr {
        cheat_caller_address_once(dvn, dvn);
        access_control.revoke_role(ALLOW_LIST_ROLE, allowed_address);
        allow_list_len -= 1;

        assert_eq(base_worker.get_allow_list_size(), allow_list_len);
    }

    assert_eq(base_worker.get_allow_list_size(), 0);
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_admin_revokes_admin_roles(
    admin: ContractAddress, admin_to_revoke: ContractAddress, vid: u32,
) {
    let DvnDeploy {
        dvn, access_control, ..,
    } = deploy_dvn(array![].span(), vid, array![admin].span());

    // Admin revokes message lib role
    cheat_caller_address_once(dvn, admin);
    access_control.revoke_role(ADMIN_ROLE, admin_to_revoke);

    // Check that admin_to_revoke does not have the admin role
    assert(!access_control.has_role(ADMIN_ROLE, admin_to_revoke), 'Admin role should not be set');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_renounce_roles_disabled(
    admin: ContractAddress,
    msg_lib: ContractAddress,
    allow_address: ContractAddress,
    deny_address: ContractAddress,
) {
    let DvnDeploy {
        access_control, safe_access_control, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![msg_lib].span(),
            VID,
            PRICE_FEED,
            array![admin].span(),
            array![allow_address].span(),
            array![deny_address].span(),
        );

    // Check roles
    assert(access_control.has_role(ADMIN_ROLE, admin), 'Admin role');
    assert(access_control.has_role(MESSAGE_LIB_ROLE, msg_lib), 'Message lib role');
    assert(access_control.has_role(ALLOW_LIST_ROLE, allow_address), 'Allow list role');
    assert(access_control.has_role(DENY_LIST_ROLE, deny_address), 'Deny list role');

    // Admin cannot renounce role
    let res = safe_access_control.renounce_role(ADMIN_ROLE, admin);
    assert_panic_with_error(res, err_role_renouncing_disabled());

    // Msg lib cannot renounce role
    let res = safe_access_control.renounce_role(MESSAGE_LIB_ROLE, msg_lib);
    assert_panic_with_error(res, err_role_renouncing_disabled());

    // Allowed address cannot renounce role
    let res = safe_access_control.renounce_role(ALLOW_LIST_ROLE, allow_address);
    assert_panic_with_error(res, err_role_renouncing_disabled());

    // Denied address cannot renounce role
    let res = safe_access_control.renounce_role(DENY_LIST_ROLE, deny_address);
    assert_panic_with_error(res, err_role_renouncing_disabled());

    // Check that users roles are not renounced
    assert(access_control.has_role(ADMIN_ROLE, admin), 'Admin role');
    assert(access_control.has_role(MESSAGE_LIB_ROLE, msg_lib), 'Message lib role');
    assert(access_control.has_role(ALLOW_LIST_ROLE, allow_address), 'Allow list role');
    assert(access_control.has_role(DENY_LIST_ROLE, deny_address), 'Deny list role');
}

//////////////////////
// Assign job tests //
//////////////////////

#[test]
#[fuzzer(runs: 10)]
fn assign_job_should_succeed_when_caller_is_message_lib(
    admin: ContractAddress, msg_lib: ContractAddress,
) {
    let DvnDeploy {
        dvn, layerzero_worker, base_worker, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![msg_lib].span(),
            VID,
            PRICE_FEED,
            array![admin].span(),
            array![].span(),
            array![].span(),
        );

    // Set worker fee lib
    cheat_caller_address_once(dvn, admin);
    base_worker.set_worker_fee_lib(WORKER_FEE_LIB);
    start_mock_call(WORKER_FEE_LIB, selector!("get_fee"), MOCK_FEE);

    // Caller has message lib role
    cheat_caller_address_once(dvn, msg_lib);
    layerzero_worker.assign_job(create_mock_quote_params(msg_lib, DST_EID));
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn assign_job_should_fail_when_caller_is_not_message_lib(
    admin: ContractAddress, allow_address: ContractAddress, deny_address: ContractAddress,
) {
    let DvnDeploy {
        dvn, safe_layerzero_worker, base_worker, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![].span(),
            VID,
            PRICE_FEED,
            array![admin].span(),
            array![allow_address].span(),
            array![deny_address].span(),
        );

    // Set worker fee lib
    cheat_caller_address_once(dvn, admin);
    base_worker.set_worker_fee_lib(WORKER_FEE_LIB);
    start_mock_call(WORKER_FEE_LIB, selector!("get_fee"), MOCK_FEE);

    // Caller is an admin but not a message lib
    cheat_caller_address_once(dvn, admin);
    let res = safe_layerzero_worker.assign_job(create_mock_quote_params(admin, DST_EID));
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Caller is on allow list but not a message lib
    cheat_caller_address_once(dvn, allow_address);
    let res = safe_layerzero_worker.assign_job(create_mock_quote_params(allow_address, DST_EID));
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Caller is on deny list and not a message lib
    cheat_caller_address_once(dvn, deny_address);
    let res = safe_layerzero_worker.assign_job(create_mock_quote_params(deny_address, DST_EID));
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

/////////////////
// Quote tests //
/////////////////

#[test]
#[fuzzer(runs: 10)]
fn quote_should_succeed_when_caller_not_denied_and_empty_allow_list(
    admin: ContractAddress, msg_lib: ContractAddress, random_address: ContractAddress,
) {
    let DvnDeploy {
        dvn, layerzero_worker, base_worker, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![msg_lib].span(),
            VID,
            PRICE_FEED,
            array![admin].span(),
            array![].span(),
            array![].span(),
        );

    // Set worker fee lib
    cheat_caller_address_once(dvn, admin);
    base_worker.set_worker_fee_lib(WORKER_FEE_LIB);
    start_mock_call(WORKER_FEE_LIB, selector!("get_fee"), MOCK_FEE);

    layerzero_worker.quote(create_mock_quote_params(admin, DST_EID));
    layerzero_worker.quote(create_mock_quote_params(msg_lib, DST_EID));
    layerzero_worker.quote(create_mock_quote_params(random_address, DST_EID));
}

#[test]
#[fuzzer(runs: 10)]
fn quote_should_succeed_when_caller_is_allowed(
    admin: ContractAddress, allow_address: ContractAddress,
) {
    let DvnDeploy {
        dvn, layerzero_worker, base_worker, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![].span(),
            VID,
            PRICE_FEED,
            array![admin].span(),
            array![allow_address].span(),
            array![].span(),
        );

    // Set worker fee lib
    cheat_caller_address_once(dvn, admin);
    base_worker.set_worker_fee_lib(WORKER_FEE_LIB);
    start_mock_call(WORKER_FEE_LIB, selector!("get_fee"), MOCK_FEE);

    // Sender is on allow list
    layerzero_worker.quote(create_mock_quote_params(allow_address, DST_EID));
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn quote_should_fail_when_caller_is_not_allowed(
    admin: ContractAddress,
    msg_lib: ContractAddress,
    allow_address: ContractAddress,
    deny_address: ContractAddress,
) {
    let DvnDeploy {
        dvn, safe_layerzero_worker, base_worker, ..,
    } =
        deploy_dvn_with_access_control_lists(
            array![msg_lib].span(),
            VID,
            PRICE_FEED,
            array![admin].span(),
            array![allow_address].span(),
            array![deny_address].span(),
        );

    // Set worker fee lib
    cheat_caller_address_once(dvn, admin);
    base_worker.set_worker_fee_lib(WORKER_FEE_LIB);
    start_mock_call(WORKER_FEE_LIB, selector!("get_fee"), MOCK_FEE);

    // Allow list is non-empty - caller is not on allow list
    cheat_caller_address_once(dvn, admin);
    let res = safe_layerzero_worker.quote(create_mock_quote_params(admin, DST_EID));
    assert_panic_with_error(res, err_sender_not_allowed());

    // Allow list is non-empty - caller is not on allow list
    cheat_caller_address_once(dvn, msg_lib);
    let res = safe_layerzero_worker.quote(create_mock_quote_params(msg_lib, DST_EID));
    assert_panic_with_error(res, err_sender_not_allowed());

    // Caller is on deny list
    cheat_caller_address_once(dvn, deny_address);
    let res = safe_layerzero_worker.quote(create_mock_quote_params(deny_address, DST_EID));
    assert_panic_with_error(res, err_sender_not_allowed());
}

//////////////////////////
// Set dst config tests //
//////////////////////////

/// Set dst configs succeeds when caller is admin
#[test]
#[fuzzer(runs: 10)]
fn set_dst_config_should_succeed_when_caller_is_admin(
    admin: ContractAddress,
    vid: u32,
    dst_eid_1: Eid,
    dst_eid_2: Eid,
    config_1: DstConfig,
    config_2: DstConfig,
) {
    let DvnDeploy { dvn, dispatcher, .. } = deploy_dvn(array![].span(), vid, array![admin].span());

    let dst_eid_1 = dst_eid_1.eid;
    let dst_eid_2 = dst_eid_2.eid;
    let params = array![
        SetDstConfigParams { dst_eid: dst_eid_1, config: config_1 },
        SetDstConfigParams { dst_eid: dst_eid_2, config: config_2 },
    ];

    // Set the dst configs
    // Caller has admin role
    cheat_caller_address_once(dvn, admin);
    dispatcher.set_dst_config(params);

    // Check that the configs were set correctly
    assert_eq(dispatcher.get_dst_config(dst_eid_1), config_1);
    assert_eq(dispatcher.get_dst_config(dst_eid_2), config_2);
}

///////////////////
// Execute tests //
///////////////////

/// Execute call data succeeds when caller is admin
#[test]
#[fuzzer(runs: 10)]
fn execute_should_succeed_when_caller_is_admin(
    admins: ContractAddressArrayList,
    vid: u32,
    dst_eid: Eid,
    config: DstConfig,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
) {
    let dst_eid = dst_eid.eid;
    let expiration: u256 = expiry.expiry.into();

    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, admins.arr.span(), array![].span(), array![].span(),
        );

    // create call data for set dst config
    let set_dst_config_params = array![SetDstConfigParams { dst_eid, config }];

    let mut serialized_config = array![];
    set_dst_config_params.serialize(ref serialized_config);

    let call_data = Call {
        to: dvn, selector: selector!("set_dst_config"), calldata: serialized_config.into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    // Execute with the given params for each admin
    for admin in admins.arr {
        // Caller has admin role
        start_cheat_caller_address(dvn, admin);
        dispatcher.execute(execute_params.clone());

        // Check that the config was set correctly
        assert_eq(dispatcher.get_dst_config(dst_eid), config);
        dispatcher.set_dst_config(array![Default::default()]);

        stop_cheat_caller_address(dvn);
    }
}

#[test]
#[fuzzer(runs: 10)]
fn execute_should_skip_if_vid_is_invalid(
    admin: ContractAddress,
    vid: u32,
    dst_eid: Eid,
    config: DstConfig,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
) {
    let dst_eid = dst_eid.eid;
    let expiration: u256 = expiry.expiry.into();

    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );
    let set_dst_config_params = array![SetDstConfigParams { dst_eid, config }];

    let mut serialized_config = array![];
    set_dst_config_params.serialize(ref serialized_config);

    let call_data = Call {
        to: dvn, selector: selector!("set_dst_config"), calldata: serialized_config.into(),
    };

    // Use an invalid vid
    let invalid_vid = vid + 1;
    let hash = dispatcher.hash_call_data(invalid_vid, call_data, expiration);

    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid: invalid_vid, call_data, expiration, signatures: signatures.into() },
    ];

    // Execute with the given params
    // Caller has admin role
    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that the config was not set
    assert_eq(dispatcher.get_dst_config(dst_eid), Default::default());
}

#[test]
#[fuzzer(runs: 10)]
fn execute_should_skip_if_expired(
    admins: ContractAddressArrayList,
    vid: u32,
    dst_eid: Eid,
    config: DstConfig,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
) {
    let dst_eid = dst_eid.eid;
    let expiration = expiry.expiry;

    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, admins.arr.span(), array![].span(), array![].span(),
        );

    let set_dst_config_params = array![SetDstConfigParams { dst_eid, config }];
    let mut serialized_config = array![];
    set_dst_config_params.serialize(ref serialized_config);

    let call_data = Call {
        to: dvn, selector: selector!("set_dst_config"), calldata: serialized_config.into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration.into());
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam {
            vid, call_data, expiration: expiration.into(), signatures: signatures.into(),
        },
    ];

    // Set the block timestamp to be past expiration
    start_cheat_block_timestamp(dvn, expiration + 1);

    // Execute with the given params
    for admin in admins.arr {
        // Caller has admin role
        cheat_caller_address_once(dvn, admin);
        dispatcher.execute(execute_params.clone());

        // Check that the config was not set
        assert_eq(dispatcher.get_dst_config(dst_eid), Default::default());
    }

    stop_cheat_block_timestamp(dvn);
}

#[test]
#[fuzzer(runs: 10)]
fn execute_should_emit_verify_signatures_failed(
    admin: ContractAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    key_pair_3: KeyPair,
    expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    let call_data = Call {
        to: dvn, selector: selector!("set_dst_config"), calldata: array![].into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = array![sign_for_test_k1(key_pair_3.private_key, hash.into(), 3)];

    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    let mut spy = spy_events();

    // Execute with the given params
    // Caller has admin role
    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that the VerifySignaturesFailed event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    dvn,
                    Dvn::Event::VerifySignaturesFailed(
                        events::VerifySignaturesFailed { error: err_signature_error() },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn execute_should_emit_hash_already_used(
    admin: ContractAddress,
    vid: u32,
    dst_eid: Eid,
    config: DstConfig,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
) {
    let dst_eid = dst_eid.eid;
    let expiration: u256 = expiry.expiry.into();

    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    let set_dst_config_params = array![SetDstConfigParams { dst_eid, config }];
    let mut serialized_config = array![];
    set_dst_config_params.serialize(ref serialized_config);

    let call_data = Call {
        to: dvn, selector: selector!("set_dst_config"), calldata: serialized_config.into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_param = ExecuteParam { vid, call_data, expiration, signatures: signatures.into() };

    let mut spy = spy_events();

    // Execute the same call twice
    // Caller has admin role
    start_cheat_caller_address(dvn, admin);
    dispatcher.execute(array![execute_param.clone(), execute_param.clone()]);
    stop_cheat_caller_address(dvn);

    // Check that the HashAlreadyUsed event was emitted
    spy
        .assert_emitted(
            @array![
                (dvn, Dvn::Event::HashAlreadyUsed(events::HashAlreadyUsed { execute_param, hash })),
            ],
        );

    // Check that the hash was used
    assert(dispatcher.get_used_hash(hash), 'Hash should be used');
}

////////////////////
// Multisig tests //
////////////////////

#[test]
#[fuzzer(runs: 10)]
fn mutlisig_set_signer_should_succeed_on_valid_signer(
    admin: ContractAddress,
    new_signer: EthAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    // Serialize calldata
    let mut serialized_calldata = array![];
    let active = true;

    new_signer.serialize(ref serialized_calldata);
    active.serialize(ref serialized_calldata);

    let call_data = Call {
        to: dvn, selector: selector!("set_signer"), calldata: serialized_calldata.into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    let mut spy = spy_events();

    // Execute with the given params
    // Caller must be an admin for only the first call to satisfy the permissions of execute
    // Since upgrade is permissioned by multisig, we need that call to come from the dvn contract
    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that the signer was set
    let multisig_dispatcher = IMultisigDispatcher { contract_address: dvn };
    assert(multisig_dispatcher.is_signer(new_signer), 'Signer should be set');

    // Check that the SignerSet event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    dvn,
                    Dvn::Event::MultisigEvent(
                        MultisigComponent::Event::SignerSet(
                            SignerSet { signer: new_signer, active },
                        ),
                    ),
                ),
            ],
        );
}

// This test ensures that setting the zero address as a signer fails with the expected error
// Can't use assert_panic_with_error because it doesn't work with syscall errors
#[test]
#[fuzzer(runs: 10)]
fn multisig_set_signer_should_fail_on_invalid_signer(
    admin: ContractAddress, vid: u32, key_pair_1: KeyPair, key_pair_2: KeyPair, expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();

    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    let mut serialized_calldata = array![];
    let signer_0 = ZERO_ADDRESS;
    let active = true;
    signer_0.serialize(ref serialized_calldata);
    active.serialize(ref serialized_calldata);

    let call_data = Call {
        to: dvn, selector: selector!("set_signer"), calldata: serialized_calldata.into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    let mut spy = spy_events();

    // Attempt to execute with the given params
    // Caller must be an admin for only the first call to satisfy the permissions of execute
    // Since upgrade is permissioned by multisig, we need that call to come from the dvn contract
    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    let event = spy.get_events();

    // TODO(Levi): find a way to check that it is execute failed emitted
    // this happens because current event returns array of internal error
    assert_eq(event.events.len(), 1);
}

#[test]
#[fuzzer(runs: 10)]
fn multisig_set_threshold_should_succeed_when_valid(
    admin: ContractAddress, vid: u32, key_pair_1: KeyPair, key_pair_2: KeyPair, expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    // This is the only valid threshold for 2 signers
    let threshold = 1;

    // Serialize calldata
    let mut serialized_calldata = array![];
    threshold.serialize(ref serialized_calldata);

    let call_data = Call {
        to: dvn, selector: selector!("set_threshold"), calldata: serialized_calldata.into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    let mut spy = spy_events();

    // Execute with the given params
    // Caller must be an admin for only the first call to satisfy the permissions of execute
    // Since upgrade is permissioned by multisig, we need that call to come from the dvn contract
    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that the threshold was set
    let multisig_dispatcher = IMultisigDispatcher { contract_address: dvn };
    assert_eq(multisig_dispatcher.get_threshold(), threshold);

    // Check that the ThresholdSet event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    dvn,
                    Dvn::Event::MultisigEvent(
                        MultisigComponent::Event::ThresholdSet(ThresholdSet { threshold }),
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn multisig_set_threshold_should_fail_when_invalid(
    admin: ContractAddress, vid: u32, key_pair_1: KeyPair, key_pair_2: KeyPair, expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    // Serialize calldata
    let threshold = 0;
    let mut serialized_calldata = array![];
    threshold.serialize(ref serialized_calldata);

    let call_data = Call {
        to: dvn, selector: selector!("set_threshold"), calldata: serialized_calldata.into(),
    };

    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    let mut spy = spy_events();

    // Attempt to execute with the given params
    // Caller must be an admin for only the first call to satisfy the permissions of execute
    // Since upgrade is permissioned by multisig, we need that call to come from the dvn contract
    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    let event = spy.get_events();

    // TODO(Levi): find a way to check that it is execute failed emitted
    // this happens because current event returns array of internal error
    assert_eq(event.events.len(), 1);
}

///////////////////
// Upgrade tests //
///////////////////

#[test]
#[fuzzer(runs: 10)]
fn upgrade_succeeds(vid: u32, key_pair_1: KeyPair, key_pair_2: KeyPair) {
    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    let new_class_hash = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;

    // Upgrade
    cheat_caller_address_once(dvn, dvn);
    dispatcher.upgrade(*new_class_hash);

    // Check that the contract was upgraded
    assert_eq(get_class_hash(dvn), *new_class_hash);
}

#[test]
#[fuzzer(runs: 10)]
fn upgrade_via_execute_succeeds(
    admin: ContractAddress, vid: u32, key_pair_1: KeyPair, key_pair_2: KeyPair, expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers = array![key_pair_1.public_address.clone(), key_pair_2.public_address.clone()];
    let DvnDeploy {
        dvn, dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![admin].span(), array![].span(), array![].span(),
        );

    let new_class_hash = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;

    let mut calldata = array![];
    new_class_hash.serialize(ref calldata);

    let call_data = Call { to: dvn, selector: selector!("upgrade"), calldata: calldata.into() };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);

    let execute_params = array![
        ExecuteParam { vid, call_data, expiration, signatures: signatures.into() },
    ];

    // Execute with the given params
    // Caller must be an admin for only the first call to satisfy the permissions of execute
    // Since upgrade is permissioned by multisig, we need that call to come from the dvn contract
    cheat_caller_address_once(dvn, admin);
    dispatcher.execute(execute_params);

    // Check that the contract was upgraded
    assert_eq(get_class_hash(dvn), *new_class_hash);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn upgrade_fails_when_not_multisig(vid: u32) {
    let DvnDeploy { safe_dispatcher, .. } = deploy_dvn(array![].span(), vid, array![].span());
    let new_class_hash = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;
    let res = safe_dispatcher.upgrade(*new_class_hash);

    // Check that the upgrade failed
    assert_panic_with_error(res, err_only_multisig());
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn upgrade_and_call_succeeds(admin: ContractAddress, vid: u32) {
    let DvnDeploy { dvn, dispatcher, .. } = deploy_dvn(array![].span(), vid, array![admin].span());

    // Deploy mock DVN contract
    let new_class_hash = declare("MockDVN").unwrap_syscall().contract_class().class_hash;

    // Upgrade and call from self
    cheat_caller_address_once(dvn, dvn);
    let mut serialized_res = dispatcher
        .upgrade_and_call(
            *new_class_hash, selector!("get_dst_config"), array![1_u32.into()].span(),
        );

    // Check that the function was called correctly
    let res: DstConfig = Serde::deserialize(ref serialized_res).unwrap();
    assert(res == MockDVN::DST_CONFIG_2, 'Function should be called');

    // Check that the contract was upgraded
    assert_eq(get_class_hash(dvn), *new_class_hash);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn upgrade_and_call_fails_when_not_multisig(vid: u32) {
    let DvnDeploy { safe_dispatcher, .. } = deploy_dvn(array![].span(), vid, array![].span());
    let new_class_hash = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;
    let res = safe_dispatcher.upgrade_and_call(*new_class_hash, 0, array![].span());

    // Check that the upgrade failed
    assert_panic_with_error(res, err_only_multisig());
}

///////////////////////////////
// Quorum change admin tests //
///////////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn quorum_should_change_admin(
    new_admin: ContractAddress,
    sender: ContractAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, access_control, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    // Serialize the new admin address
    let mut new_admin_serialized = array![];
    new_admin.serialize(ref new_admin_serialized);

    let call_data = Call {
        to: dvn, selector: selector!("quorum_change_admin"), calldata: new_admin_serialized.into(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);

    // Create the execute param
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let param = ExecuteParam { vid, call_data, expiration, signatures: signatures.into() };

    let mut spy = spy_events();

    // Call the function
    // Anyone can call this function, we need to know the caller address for the event assertion
    cheat_caller_address_once(dvn, sender);
    dispatcher.quorum_change_admin(param);

    // Check that the new admin has the admin role
    assert!(access_control.has_role(ADMIN_ROLE, new_admin), "New admin should have admin role");

    spy
        .assert_emitted(
            @array![
                (
                    dvn,
                    Dvn::Event::AccessControlEvent(
                        AccessControlComponent::Event::RoleGranted(
                            AccessControlComponent::RoleGranted {
                                role: ADMIN_ROLE, account: new_admin, sender,
                            },
                        ),
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn quorum_should_fail_to_change_admin_if_expired(
    new_admin: ContractAddress, vid: u32, key_pair_1: KeyPair, key_pair_2: KeyPair, expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, safe_dispatcher, access_control, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    // Serialize the new admin address
    let mut new_admin_serialized = array![];
    new_admin.serialize(ref new_admin_serialized);

    // Create the call data & hash
    let call_data = Call {
        to: dvn, selector: selector!("quorum_change_admin"), calldata: new_admin_serialized.span(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);

    // Create the execute param
    let signatures = build_signatures(array![key_pair_1.clone(), key_pair_2.clone()].span(), hash);
    let param = ExecuteParam { vid, call_data, expiration, signatures: signatures.into() };

    // Call the function outside of the expiration time
    start_cheat_block_timestamp(dvn, (expiration + 1).try_into().unwrap());
    let res = safe_dispatcher.quorum_change_admin(param);
    stop_cheat_block_timestamp(dvn);

    // Check that the admin is not changed because the instruction is expired
    assert_panic_with_error(res, errors::err_instruction_expired());
    assert(!access_control.has_role(ADMIN_ROLE, new_admin), 'Should not have admin role');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn quorum_should_fail_to_change_admin_if_invalid_vid(
    new_admin: ContractAddress,
    vid: u32,
    invalid_vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
) {
    // Ensure that vid and invalid_vid are different
    if vid == invalid_vid {
        return;
    }

    let expiration: u256 = expiry.expiry.into();
    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, safe_dispatcher, access_control, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    // Serialize the new admin address
    let mut new_admin_serialized = array![];
    new_admin.serialize(ref new_admin_serialized);

    // Create the call data & hash
    let call_data = Call {
        to: dvn, selector: selector!("quorum_change_admin"), calldata: new_admin_serialized.span(),
    };
    let hash = dispatcher.hash_call_data(invalid_vid, call_data, expiration);

    // Create the execute param
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let param = ExecuteParam {
        vid: invalid_vid, call_data, expiration, signatures: signatures.into(),
    };

    // Call the function with invalid VID
    let res = safe_dispatcher.quorum_change_admin(param);

    // Check that the admin is not changed because the VID is invalid
    assert_panic_with_error(res, errors::err_invalid_vid(invalid_vid));
    assert(!access_control.has_role(ADMIN_ROLE, new_admin), 'Should not have admin role');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn quorum_should_fail_to_change_admin_if_invalid_target(
    new_admin: ContractAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    invalid_target: ContractAddress,
    expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, safe_dispatcher, access_control, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    // Ensure that the invalid target is different from the DVN
    if invalid_target == dvn {
        return;
    }

    // Serialize the new admin address
    let mut new_admin_serialized = array![];
    new_admin.serialize(ref new_admin_serialized);

    // Create the call data & hash
    let call_data = Call {
        to: invalid_target,
        selector: selector!("quorum_change_admin"),
        calldata: new_admin_serialized.span(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);

    // Create the execute param
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let param = ExecuteParam { vid, call_data, expiration, signatures: signatures.into() };

    // Call the function with invalid target
    let res = safe_dispatcher.quorum_change_admin(param);

    // Check that the admin is not changed because the target is invalid
    assert_panic_with_error(res, errors::err_invalid_target(invalid_target));
    assert(!access_control.has_role(ADMIN_ROLE, new_admin), 'Should not have admin role');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn quorum_should_fail_to_change_admin_if_duplicated_hash(
    admin: ContractAddress, vid: u32, key_pair_1: KeyPair, key_pair_2: KeyPair, expiry: Expiry,
) {
    let expiration: u256 = expiry.expiry.into();
    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, safe_dispatcher, access_control, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    // Serialize the admin address
    let mut admin_serialized = array![];
    admin.serialize(ref admin_serialized);

    // Create the call data & hash
    let call_data = Call {
        to: dvn, selector: selector!("quorum_change_admin"), calldata: admin_serialized.span(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);

    // Create the execute param
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let param = ExecuteParam { vid, call_data, expiration, signatures: signatures.into() };

    // Call the function for the first time
    dispatcher.quorum_change_admin(param.clone());

    // Check that admin has the admin role
    assert(access_control.has_role(ADMIN_ROLE, admin), 'Admin should have admin role');

    // Call the function again with the same param
    let res = safe_dispatcher.quorum_change_admin(param);

    // Check that the function fails because the hash is duplicated
    assert_panic_with_error(res, errors::err_duplicated_hash(hash));
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn quorum_should_fail_to_change_admin_if_invalid_calldata(
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    invalid_calldata: Felt252ArrayList,
    expiry: Expiry,
) {
    // Ensure that invalid_calldata is not a serialized contract address
    let invalid_calldata = invalid_calldata.arr;
    let mut serialized = invalid_calldata.span();
    let res: Option<ContractAddress> = Serde::deserialize(ref serialized);
    if res.is_some() {
        return;
    }

    let expiration: u256 = expiry.expiry.into();
    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, safe_dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    // Create the call data & hash
    let call_data = Call {
        to: dvn, selector: selector!("quorum_change_admin"), calldata: invalid_calldata.span(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);

    // Create the execute param
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let param = ExecuteParam { vid, call_data, expiration, signatures: signatures.into() };

    // Call the function with invalid calldata
    let res = safe_dispatcher.quorum_change_admin(param);

    // Check that the function fails because the calldata is invalid
    assert_panic_with_error(res, errors::err_invalid_quorum_admin());
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn quorum_should_fail_to_change_admin_if_invalid_selector(
    invalid_selector: felt252,
    sender: ContractAddress,
    vid: u32,
    key_pair_1: KeyPair,
    key_pair_2: KeyPair,
    expiry: Expiry,
    new_admin: ContractAddress,
) {
    // Ensure that invalid_selector is invalid
    if invalid_selector == selector!("quorum_change_admin") {
        return;
    }

    let expiration: u256 = expiry.expiry.into();
    let signers: Array<EthAddress> = array![
        key_pair_1.public_address.clone().into(), key_pair_2.public_address.clone().into(),
    ];
    let DvnDeploy {
        dvn, dispatcher, safe_dispatcher, ..,
    } =
        deploy_dvn_with_additional_roles(
            array![].span(), vid, signers, array![].span(), array![].span(), array![].span(),
        );

    // Create calldata with invalid selector
    let mut new_admin_serialized = array![];
    new_admin.serialize(ref new_admin_serialized);

    let call_data = Call {
        to: dvn, selector: invalid_selector, calldata: new_admin_serialized.into(),
    };
    let hash = dispatcher.hash_call_data(vid, call_data, expiration);

    // Create the execute param
    let signatures = build_signatures(array![key_pair_1, key_pair_2].span(), hash);
    let param = ExecuteParam { vid, call_data, expiration, signatures: signatures.into() };

    // Call the function with invalid selector
    cheat_caller_address_once(dvn, sender);
    let res = safe_dispatcher.quorum_change_admin(param);

    // Check that the function fails because the selector is invalid
    assert_panic_with_error(res, errors::err_invalid_selector(invalid_selector));
}

//////////////////////////
// Implementation tests //
//////////////////////////

#[test]
fn impl_layer_zero_worker_interface() {
    const VID: u32 = 1;
    let DvnDeploy { dvn, .. } = deploy_dvn(array![].span(), VID, array![].span());

    /// Runtime check that the dvn implements the ILayerZeroWorker interface
    ILayerZeroWorkerDispatcher { contract_address: dvn };
}
