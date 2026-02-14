//! Executor tests

use core::num::traits::Pow;
use layerzero::Origin;
use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::endpoint::events as endpoint_events;
use layerzero::endpoint::messaging_composer::events::{ComposeDelivered, LzComposeAlert};
use layerzero::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent;
use layerzero::workers::access_control::{
    ADMIN_ROLE, ALLOW_LIST_ROLE, DEFAULT_ADMIN_ROLE, DENY_LIST_ROLE, MESSAGE_LIB_ROLE,
};
use layerzero::workers::base::errors::err_role_renouncing_disabled;
use layerzero::workers::base::interface::IWorkerBaseDispatcherTrait;
use layerzero::workers::executor::errors;
use layerzero::workers::executor::events::NativeDropApplied;
use layerzero::workers::executor::executor::Executor;
use layerzero::workers::executor::interface::{
    IExecutorDispatcherTrait, IExecutorSafeDispatcherTrait,
};
use layerzero::workers::executor::structs::{
    ComposeParams, DstConfig, ExecuteParams, NativeDropParams, SetDstConfigParams,
};
use layerzero::workers::interface::{
    ILayerZeroWorkerDispatcher, ILayerZeroWorkerDispatcherTrait,
    ILayerZeroWorkerSafeDispatcherTrait,
};
use layerzero::workers::price_feed::structs::GetFeeResponse;
use openzeppelin::access::accesscontrol::AccessControlComponent;
use openzeppelin::access::accesscontrol::interface::{
    IAccessControlDispatcherTrait, IAccessControlSafeDispatcherTrait,
};
use openzeppelin::security::interface::{IPausableDispatcher, IPausableDispatcherTrait};
use openzeppelin::security::pausable::PausableComponent;
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::{
    DeclareResultTrait, EventSpyAssertionsTrait, EventSpyTrait, IsEmitted, declare, get_class_hash,
    spy_events, start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
    stop_mock_call,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::constants::assert_eq;
use crate::endpoint::utils::{MessagingComposerMock, deploy_mock_messaging_composer};
use crate::fuzzable::contract_address::{
    ContractAddressArrayList, FuzzableContractAddress, FuzzableContractAddresses,
};
use crate::fuzzable::dst_config::FuzzableExecutorDstConfig;
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::origin::FuzzableOrigin;
use crate::fuzzable::role_admin::{FuzzableRoleAdmin, RoleAdmin};
use crate::mocks::endpoint::MockEndpointV2;
use crate::mocks::endpoint::MockEndpointV2::{
    MockEndpointV2HelpersDispatcher, MockEndpointV2HelpersDispatcherTrait,
};
use crate::mocks::messaging_composer::MockMessagingComposer;
use crate::mocks::messaging_composer::MockMessagingComposer::MockMessagingComposerHelpersDispatcherTrait;
use crate::mocks::workers::executor::executor::MockExecutor;
use crate::workers::executor::utils::{
    ExecutorFeeLibTest, ExecutorMock, ExecutorOptionBytes, ExecutorTest, create_mock_compose_params,
    create_mock_execute_params, create_mock_quote_params, deploy_executor, deploy_executor_fee_lib,
    deploy_mock_executor, serialize_executor_options, serialize_lz_receive_option,
};

// Test addresses
const PRICE_FEED: ContractAddress = 'price_feed'.try_into().unwrap();
const ENDPOINT_OWNER: ContractAddress = 'endpoint_owner'.try_into().unwrap();
const TOKEN_OWNER: ContractAddress = 'token_owner'.try_into().unwrap();

// Test values
const EID: u32 = 1;

//////////////////////////
// Access control tests //
//////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn access_control_initial_roles_set_correctly(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    message_libs: ContractAddressArrayList,
    admins: ContractAddressArrayList,
    token_owner: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        access_control, dispatcher, endpoint, ..,
    } =
        deploy_executor(
            endpoint_owner,
            message_libs.arr.span(),
            price_feed,
            role_admin,
            admins.arr.span(),
            token_owner,
            eid.eid,
        );

    // Check that role admin was set correctly
    assert(access_control.has_role(DEFAULT_ADMIN_ROLE, role_admin), 'Default admin role');
    assert(!access_control.has_role(ADMIN_ROLE, role_admin), 'Admin role');
    assert(!access_control.has_role(MESSAGE_LIB_ROLE, role_admin), 'Message lib role');
    assert(!access_control.has_role(ALLOW_LIST_ROLE, role_admin), 'Allow list role');
    assert(!access_control.has_role(DENY_LIST_ROLE, role_admin), 'Deny list role');

    // Check that admin roles were set correctly
    for admin in admins.arr {
        assert(access_control.has_role(ADMIN_ROLE, admin), 'Admin role');
        assert(!access_control.has_role(MESSAGE_LIB_ROLE, admin), 'Message lib role');
        assert(!access_control.has_role(DEFAULT_ADMIN_ROLE, admin), 'Default admin role');
        assert(!access_control.has_role(ALLOW_LIST_ROLE, admin), 'Allow list role');
        assert(!access_control.has_role(DENY_LIST_ROLE, admin), 'Deny list role');
    }

    // Check that message lib roles were set correctly
    for msg_lib in message_libs.arr {
        assert(access_control.has_role(MESSAGE_LIB_ROLE, msg_lib), 'Message lib role');
        assert(!access_control.has_role(ADMIN_ROLE, msg_lib), 'Admin role');
        assert(!access_control.has_role(DEFAULT_ADMIN_ROLE, msg_lib), 'Default admin role');
        assert(!access_control.has_role(ALLOW_LIST_ROLE, msg_lib), 'Allow list role');
        assert(!access_control.has_role(DENY_LIST_ROLE, msg_lib), 'Deny list role');
    }

    // Check that the EID was set correctly
    assert_eq(dispatcher.get_eid(), eid.eid);

    // Check that the endpoint was set correctly
    assert_eq(dispatcher.get_endpoint(), endpoint);
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_default_admin_can_grant_all_roles(
    role_admin: RoleAdmin,
    another_default_admin: ContractAddress,
    admin: ContractAddress,
    message_lib: ContractAddress,
    allow_address: ContractAddress,
    deny_address: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![].span(),
            PRICE_FEED,
            role_admin,
            array![].span(),
            TOKEN_OWNER,
            EID,
        );

    start_cheat_caller_address(executor, role_admin);

    // Role admin can grant default admin role
    access_control.grant_role(DEFAULT_ADMIN_ROLE, another_default_admin);
    assert(
        access_control.has_role(DEFAULT_ADMIN_ROLE, another_default_admin), 'Default admin role',
    );

    // Role admin can grant admin role
    access_control.grant_role(ADMIN_ROLE, admin);
    assert(access_control.has_role(ADMIN_ROLE, admin), 'Admin role');

    // Role admin can grant message lib role
    access_control.grant_role(MESSAGE_LIB_ROLE, message_lib);
    assert(access_control.has_role(MESSAGE_LIB_ROLE, message_lib), 'Message lib role');

    // Role admin can grant allow list role
    access_control.grant_role(ALLOW_LIST_ROLE, allow_address);
    assert(access_control.has_role(ALLOW_LIST_ROLE, allow_address), 'Allow list role');

    // Role admin can grant deny list role
    access_control.grant_role(DENY_LIST_ROLE, deny_address);
    assert(access_control.has_role(DENY_LIST_ROLE, deny_address), 'Deny list role');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_admin_cannot_grant_roles(
    role_admin: RoleAdmin,
    another_default_admin: ContractAddress,
    admin: ContractAddress,
    another_admin: ContractAddress,
    msg_lib: ContractAddress,
    allow_address: ContractAddress,
    deny_address: ContractAddress,
) {
    let role_admin = role_admin.address;

    // Ensure that addresses are not the same
    if another_default_admin == role_admin && another_admin == admin {
        return;
    }

    let ExecutorTest {
        executor, safe_access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![].span(),
            PRICE_FEED,
            role_admin,
            array![admin].span(),
            TOKEN_OWNER,
            EID,
        );

    start_cheat_caller_address(executor, admin);

    // Admin cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, another_default_admin);
    assert(
        !safe_access_control.has_role(DEFAULT_ADMIN_ROLE, another_default_admin).unwrap(),
        'Default admin role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Admin cannot grant admin role
    let res = safe_access_control.grant_role(ADMIN_ROLE, another_admin);
    assert(!safe_access_control.has_role(ADMIN_ROLE, another_admin).unwrap(), 'Admin role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Admin cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, allow_address);
    assert(
        !safe_access_control.has_role(ALLOW_LIST_ROLE, allow_address).unwrap(), 'Allow list role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Admin cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, deny_address);
    assert(!safe_access_control.has_role(DENY_LIST_ROLE, deny_address).unwrap(), 'Deny list role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_message_lib_cannot_grant_roles(
    role_admin: RoleAdmin,
    another_default_admin: ContractAddress,
    admin: ContractAddress,
    msg_lib: ContractAddress,
    another_msg_lib: ContractAddress,
    allow_address: ContractAddress,
    deny_address: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![msg_lib].span(),
            PRICE_FEED,
            role_admin,
            array![].span(),
            TOKEN_OWNER,
            EID,
        );

    start_cheat_caller_address(executor, msg_lib);

    // Message lib cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, another_default_admin);
    assert(
        !safe_access_control.has_role(DEFAULT_ADMIN_ROLE, another_default_admin).unwrap(),
        'Default admin role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant admin role
    let res = safe_access_control.grant_role(ADMIN_ROLE, admin);
    assert(!safe_access_control.has_role(ADMIN_ROLE, admin).unwrap(), 'Admin role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant message lib role
    let res = safe_access_control.grant_role(MESSAGE_LIB_ROLE, another_msg_lib);
    assert(
        !safe_access_control.has_role(MESSAGE_LIB_ROLE, another_msg_lib).unwrap(),
        'Message lib role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, allow_address);
    assert(
        !safe_access_control.has_role(ALLOW_LIST_ROLE, allow_address).unwrap(), 'Allow list role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, deny_address);
    assert(!safe_access_control.has_role(DENY_LIST_ROLE, deny_address).unwrap(), 'Deny list role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_allow_list_cannot_grant_roles(
    role_admin: RoleAdmin,
    another_default_admin: ContractAddress,
    admin: ContractAddress,
    msg_lib: ContractAddress,
    allow_address: ContractAddress,
    another_allow_address: ContractAddress,
    deny_address: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![].span(),
            PRICE_FEED,
            role_admin,
            array![].span(),
            TOKEN_OWNER,
            EID,
        );

    // Grant allow list role to allow address
    cheat_caller_address_once(executor, role_admin);
    safe_access_control.grant_role(ALLOW_LIST_ROLE, allow_address).unwrap();

    start_cheat_caller_address(executor, allow_address);

    // Message lib cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, another_default_admin);
    assert(
        !safe_access_control.has_role(DEFAULT_ADMIN_ROLE, another_default_admin).unwrap(),
        'Default admin role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant admin role
    let res = safe_access_control.grant_role(ADMIN_ROLE, admin);
    assert(!safe_access_control.has_role(ADMIN_ROLE, admin).unwrap(), 'Admin role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant message lib role
    let res = safe_access_control.grant_role(MESSAGE_LIB_ROLE, msg_lib);
    assert(!safe_access_control.has_role(MESSAGE_LIB_ROLE, msg_lib).unwrap(), 'Message lib role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, another_allow_address);
    assert(
        !safe_access_control.has_role(ALLOW_LIST_ROLE, another_allow_address).unwrap(),
        'Allow list role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, deny_address);
    assert(!safe_access_control.has_role(DENY_LIST_ROLE, deny_address).unwrap(), 'Deny list role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_deny_list_cannot_grant_roles(
    role_admin: RoleAdmin,
    another_default_admin: ContractAddress,
    admin: ContractAddress,
    msg_lib: ContractAddress,
    allow_address: ContractAddress,
    deny_address: ContractAddress,
    another_deny_address: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![].span(),
            PRICE_FEED,
            role_admin,
            array![].span(),
            TOKEN_OWNER,
            EID,
        );

    // Grant deny list role to deny address
    cheat_caller_address_once(executor, role_admin);
    safe_access_control.grant_role(DENY_LIST_ROLE, deny_address).unwrap();

    start_cheat_caller_address(executor, deny_address);

    // Message lib cannot grant default admin role
    let res = safe_access_control.grant_role(DEFAULT_ADMIN_ROLE, another_default_admin);
    assert(
        !safe_access_control.has_role(DEFAULT_ADMIN_ROLE, another_default_admin).unwrap(),
        'Default admin role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant admin role
    let res = safe_access_control.grant_role(ADMIN_ROLE, admin);
    assert(!safe_access_control.has_role(ADMIN_ROLE, admin).unwrap(), 'Admin role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant message lib role
    let res = safe_access_control.grant_role(MESSAGE_LIB_ROLE, msg_lib);
    assert(!safe_access_control.has_role(MESSAGE_LIB_ROLE, msg_lib).unwrap(), 'Message lib role');
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant allow list role
    let res = safe_access_control.grant_role(ALLOW_LIST_ROLE, allow_address);
    assert(
        !safe_access_control.has_role(ALLOW_LIST_ROLE, allow_address).unwrap(), 'Allow list role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Message lib cannot grant deny list role
    let res = safe_access_control.grant_role(DENY_LIST_ROLE, another_deny_address);
    assert(
        !safe_access_control.has_role(DENY_LIST_ROLE, another_deny_address).unwrap(),
        'Deny list role',
    );
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_allow_list_is_managed_correctly(
    role_admin: RoleAdmin, allow_list: ContractAddressArrayList,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, access_control, base_worker, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![].span(),
            PRICE_FEED,
            role_admin,
            array![].span(),
            TOKEN_OWNER,
            EID,
        );

    // Check adding allowed addresses to allow list
    let mut allow_list_len = 0;
    for allowed_address in @allow_list.arr {
        cheat_caller_address_once(executor, role_admin);
        access_control.grant_role(ALLOW_LIST_ROLE, *allowed_address);
        allow_list_len += 1;

        assert_eq(base_worker.get_allow_list_size(), allow_list_len);
    }

    assert_eq(base_worker.get_allow_list_size(), allow_list.arr.len().into());

    // Check removing addresses from allow list
    for allowed_address in allow_list.arr {
        cheat_caller_address_once(executor, role_admin);
        access_control.revoke_role(ALLOW_LIST_ROLE, allowed_address);
        allow_list_len -= 1;

        assert_eq(base_worker.get_allow_list_size(), allow_list_len);
    }

    assert_eq(base_worker.get_allow_list_size(), 0);
}

#[test]
#[fuzzer(runs: 10)]
fn access_control_default_admin_revokes_roles(
    role_admin: RoleAdmin, admin: ContractAddress, msg_lib: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![msg_lib].span(),
            PRICE_FEED,
            role_admin,
            array![admin].span(),
            TOKEN_OWNER,
            EID,
        );

    start_cheat_caller_address(executor, role_admin);

    // Default admin revokes admin role
    access_control.revoke_role(ADMIN_ROLE, admin);
    assert(!access_control.has_role(ADMIN_ROLE, admin), 'Admin role');

    // Default admin revokes message lib role
    access_control.revoke_role(MESSAGE_LIB_ROLE, msg_lib);
    assert(!access_control.has_role(MESSAGE_LIB_ROLE, msg_lib), 'Message lib role');

    // Default admin revokes default admin role
    access_control.revoke_role(DEFAULT_ADMIN_ROLE, role_admin);
    assert(!access_control.has_role(DEFAULT_ADMIN_ROLE, role_admin), 'Default admin role');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_revoking_role_as_a_random_address(
    role_admin: RoleAdmin, random_address: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![].span(),
            PRICE_FEED,
            role_admin,
            array![].span(),
            TOKEN_OWNER,
            EID,
        );

    start_cheat_caller_address(executor, random_address);

    // Revoke role as a random address
    let res = safe_access_control.revoke_role(DEFAULT_ADMIN_ROLE, role_admin);
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn access_control_renounce_roles_disabled(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    msg_lib: ContractAddress,
    allow_address: ContractAddress,
    deny_address: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, access_control, safe_access_control, ..,
    } =
        deploy_executor(
            ENDPOINT_OWNER,
            array![msg_lib].span(),
            PRICE_FEED,
            role_admin,
            array![admin].span(),
            TOKEN_OWNER,
            EID,
        );

    // Grant roles
    start_cheat_caller_address(executor, role_admin);
    access_control.grant_role(ALLOW_LIST_ROLE, allow_address);
    access_control.grant_role(DENY_LIST_ROLE, deny_address);

    // Check roles
    assert(access_control.has_role(DEFAULT_ADMIN_ROLE, role_admin), 'Default admin role');
    assert(access_control.has_role(ADMIN_ROLE, admin), 'Admin role');
    assert(access_control.has_role(MESSAGE_LIB_ROLE, msg_lib), 'Message lib role');
    assert(access_control.has_role(ALLOW_LIST_ROLE, allow_address), 'Allow list role');
    assert(access_control.has_role(DENY_LIST_ROLE, deny_address), 'Deny list role');

    // Default admin cannot renounce role
    let res = safe_access_control.renounce_role(DEFAULT_ADMIN_ROLE, role_admin);
    assert_panic_with_error(res, err_role_renouncing_disabled());

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
    assert(access_control.has_role(DEFAULT_ADMIN_ROLE, role_admin), 'Default admin role');
    assert(access_control.has_role(ADMIN_ROLE, admin), 'Admin role');
    assert(access_control.has_role(MESSAGE_LIB_ROLE, msg_lib), 'Message lib role');
    assert(access_control.has_role(ALLOW_LIST_ROLE, allow_address), 'Allow list role');
    assert(access_control.has_role(DENY_LIST_ROLE, deny_address), 'Deny list role');
}

//////////////////////////
// Set dst config tests //
//////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn set_dst_config_succeeds_when_admin(
    endpoint_owner: ContractAddress,
    src_eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    admin: ContractAddress,
    token_owner: ContractAddress,
    dst_eid_1: Eid,
    dst_eid_2: Eid,
    dst_config_1: DstConfig,
    dst_config_2: DstConfig,
) {
    let dst_eid_1 = dst_eid_1.eid;
    let dst_eid_2 = dst_eid_2.eid;
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![admin].span(),
            token_owner,
            src_eid.eid,
        );

    // Set the dst configs
    // Caller has the admin role
    cheat_caller_address_once(executor, admin);
    dispatcher
        .set_dst_config(
            array![
                SetDstConfigParams { dst_eid: dst_eid_1, config: dst_config_1 },
                SetDstConfigParams { dst_eid: dst_eid_2, config: dst_config_2 },
            ],
        );

    // Check that the configs are set correctly
    assert_eq(dispatcher.get_dst_config(dst_eid_1), dst_config_1);
    assert_eq(dispatcher.get_dst_config(dst_eid_2), dst_config_2);
}

#[test]
#[fuzzer(runs: 10)]
fn set_dst_config_should_fail_when_not_admin(
    endpoint_owner: ContractAddress,
    src_eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    not_admin: ContractAddress,
    dst_eid: Eid,
    token_owner: ContractAddress,
    config: DstConfig,
) {
    let dst_eid = dst_eid.eid;
    let role_admin = role_admin.address;
    let params = array![SetDstConfigParams { dst_eid, config }];

    let ExecutorTest {
        executor, safe_dispatcher, access_control, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![].span(),
            token_owner,
            src_eid.eid,
        );

    // Check that not_admin is not an admin
    assert(!access_control.has_role(ADMIN_ROLE, not_admin), 'Should not be an admin');

    // Attempt to set dst config
    // Caller does not have the admin role
    cheat_caller_address_once(executor, not_admin);
    let res = safe_dispatcher.set_dst_config(params.clone());

    // Check that set dst config fails because the caller does not have the admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Set the message lib role
    // Caller is the role admin
    cheat_caller_address_once(executor, role_admin);
    access_control.grant_role(MESSAGE_LIB_ROLE, not_admin);

    // Attempt to set dst config
    // Caller has the message lib role
    cheat_caller_address_once(executor, not_admin);
    let res = safe_dispatcher.set_dst_config(params);

    // Check that set dst config fails because the caller only has the message lib role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn set_dst_config_should_fail_when_message_lib(
    endpoint_owner: ContractAddress,
    src_eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    message_libs: ContractAddressArrayList,
    dst_eid: Eid,
    token_owner: ContractAddress,
    config: DstConfig,
) {
    let dst_eid = dst_eid.eid;
    let role_admin = role_admin.address;
    let params = array![SetDstConfigParams { dst_eid, config }];

    let ExecutorTest {
        executor, safe_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            message_libs.arr.span(),
            price_feed,
            role_admin,
            array![].span(),
            token_owner,
            src_eid.eid,
        );

    // Attempt to set dst config with each message lib
    for msg_lib in message_libs.arr {
        // Caller does not have the admin role
        cheat_caller_address_once(executor, msg_lib);
        let res = safe_dispatcher.set_dst_config(params.clone());

        // Check that set dst config fails because the caller only has the message lib role
        assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
    }
}

/////////////////
// Quote tests //
/////////////////

#[test]
#[fuzzer(runs: 10)]
fn quote_should_fail_when_eid_not_supported(
    endpoint_owner: ContractAddress,
    src_eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    admin: ContractAddress,
    user: ContractAddress,
    dst_eid: Eid,
    token_owner: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, base_worker, safe_layer_zero_worker, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![admin].span(),
            token_owner,
            src_eid.eid,
        );

    // Deploy and set up fee lib
    let ExecutorFeeLibTest { fee_lib, .. } = deploy_executor_fee_lib(dst_eid.eid, admin);

    // Set the worker fee lib
    cheat_caller_address_once(executor, admin);
    base_worker.set_worker_fee_lib(fee_lib);

    // Quote the job - should fail because EID is not supported (no dst config set)
    // Caller can be any address
    cheat_caller_address_once(executor, user);
    let res = safe_layer_zero_worker
        .quote(create_mock_quote_params(user, dst_eid.eid, Default::default()));

    // Check that the quote fails because the EID is not supported
    assert_panic_with_error(res, errors::err_eid_not_supported());
}


#[test]
#[fuzzer(runs: 10)]
fn quote_should_fail_when_price_feed_not_set(
    endpoint_owner: ContractAddress,
    src_eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    user: ContractAddress,
    dst_eid: Eid,
    token_owner: ContractAddress,
    config: DstConfig,
) {
    let dst_eid = dst_eid.eid;
    let role_admin = role_admin.address;
    let mock_options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: 1, option: serialize_lz_receive_option(100, Option::Some(50)),
            },
        ],
    );

    let ExecutorTest {
        executor, dispatcher, safe_layer_zero_worker, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            ZERO_ADDRESS,
            role_admin,
            array![admin].span(),
            token_owner,
            src_eid.eid,
        );

    // Set the dst config - do not set the price feed
    // Caller has admin role
    cheat_caller_address_once(executor, admin);
    dispatcher.set_dst_config(array![SetDstConfigParams { dst_eid, config }]);

    // Check that the quote fails because the price feed is not set
    let res = safe_layer_zero_worker.quote(create_mock_quote_params(user, dst_eid, mock_options));
    assert_panic_with_error(res, errors::err_price_feed_not_set());
}

#[test]
#[fuzzer(runs: 10)]
fn quote_should_succeed(
    endpoint_owner: ContractAddress,
    src_eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    user: ContractAddress,
    price_feed: ContractAddress,
    dst_eid: Eid,
    token_owner: ContractAddress,
    config: DstConfig,
) {
    let dst_eid = dst_eid.eid;
    let role_admin = role_admin.address;

    let ExecutorTest {
        executor, base_worker, dispatcher, layer_zero_worker, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![admin].span(),
            token_owner,
            src_eid.eid,
        );

    // User wants to send 0.01 ETH and specifies 50,000 gas for execution.
    // 0.01 ETH = 10^16 wei
    let lz_receive_value = 10_u128.pow(16);
    let lz_receive_option = serialize_lz_receive_option(50000, Option::Some(lz_receive_value));
    let mock_options = serialize_executor_options(
        array![ExecutorOptionBytes { option_type: 1, option: lz_receive_option }],
    );

    // Let's assume ETH is the native token (18 decimals).
    // Let's set a 10% premium (multiplier_bps = 11000).
    // Let's set a floor margin of $1.50 USD.
    let set_dst_config_params = SetDstConfigParams {
        dst_eid,
        config: DstConfig {
            lz_receive_base_gas: 200000, // Base gas for a receive operation
            multiplier_bps: 11000, // 110% -> 10% premium
            floor_margin_usd: 1_500_000_000_000_000_000, // $1.50 with 18 decimals
            native_cap: 10_u128.pow(18), // 1 ETH cap
            lz_compose_base_gas: 0,
        },
    };

    // Deploy and set up fee lib
    let ExecutorFeeLibTest { fee_lib, .. } = deploy_executor_fee_lib(dst_eid, admin);

    // Update the set_dst_config_params to use the v2 EID
    let set_dst_config_params = SetDstConfigParams {
        dst_eid, config: set_dst_config_params.config,
    };

    // Set the dst config, price feed, and worker fee lib
    // Caller has admin role
    start_cheat_caller_address(executor, admin);
    dispatcher.set_dst_config(array![set_dst_config_params]);
    base_worker.set_price_feed(price_feed);
    base_worker.set_worker_fee_lib(fee_lib);
    stop_cheat_caller_address(executor);

    // Mock the price feed response
    // total_gas = lz_receive_base_gas (200,000) + lz_receive_option gas (50,000) = 250,000.
    // Let's say the price_feed determines this costs 0.00075 ETH.
    let mock_gas_fee = 750_000_000_000_000; // 0.00075 ETH in wei
    // 1 ETH = $3000. We send price with 18 decimals.
    let native_price_usd = 3000_u128 * 10_u128.pow(18);
    let mock_response = GetFeeResponse {
        gas_fee: mock_gas_fee,
        price_ratio: 1, // Source and dest chains use same-priced native token
        price_ratio_denominator: 1,
        native_price_usd,
    };

    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);
    let quote = layer_zero_worker.quote(create_mock_quote_params(user, dst_eid, mock_options));
    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Expected fee calculation:
    // 1. Gas Component
    // multiplier = 11000 / 10000 = 1.1
    // fee_with_multiplier = 0.00075 * 1.1 = 0.000825 ETH
    // margin_in_native = ($1.5 * 10^18) / ($3000 * 10^18 per ETH) = 0.0005 ETH
    // fee_with_margin = 0.00075 + 0.0005 = 0.00125 ETH
    // gas_component = max(0.000825, 0.00125) = 0.00125 ETH
    let gas_component = 1_250_000_000_000_000; // 0.00125 ETH in wei

    // 2. Value Component
    // total_value = 0.01 ETH from lz_receive_option
    // converted_total_value = 0.01 ETH (since price_ratio is 1)
    // value_component = 0.01 * 1.1 = 0.011 ETH
    let value_component = 11_000_000_000_000_000; // 0.011 ETH in wei

    // 3. Total Fee
    // total_fee = 0.00125 + 0.011 = 0.01225 ETH
    // Check that the quote is correct
    assert(quote == gas_component + value_component, 'Quote should be expected fee');
}

///////////////////
// Upgrade tests //
///////////////////

#[test]
#[fuzzer(runs: 10)]
fn upgrade_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
) {
    let role_admin = role_admin.address;

    let ExecutorTest {
        executor, dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![].span(),
            token_owner,
            eid.eid,
        );
    let new_class = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;

    // Upgrade the contract
    // Caller is the role admin
    cheat_caller_address_once(executor, role_admin);
    dispatcher.upgrade(*new_class);

    // Check that the upgrade succeeds
    assert_eq(get_class_hash(executor), *new_class);
}

#[test]
#[fuzzer(runs: 10)]
fn upgrade_should_fail_when_not_default_admin(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    not_role_admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![].span(),
            token_owner,
            eid.eid,
        );
    let new_class = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;

    // Attempt to upgrade the contract
    // Caller is not the role admin
    cheat_caller_address_once(executor, not_role_admin);
    let res = safe_dispatcher.upgrade(*new_class);

    // Check that the upgrade fails because not_role_admin is not the role admin
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn upgrade_and_call_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![].span(),
            token_owner,
            eid.eid,
        );

    let new_class_hash = declare("MockExecutor").unwrap_syscall().contract_class().class_hash;

    // Upgrade and call
    // Caller is the role admin
    cheat_caller_address_once(executor, role_admin);
    let mut serialized_res = dispatcher
        .upgrade_and_call(
            *new_class_hash, selector!("get_dst_config"), array![0_u32.into()].span(),
        );

    // Check that the function was called correctly
    let res: DstConfig = Serde::deserialize(ref serialized_res).unwrap();
    assert_eq(res, MockExecutor::DST_CONFIG);

    // Check that the contract was upgraded
    assert_eq(get_class_hash(executor), *new_class_hash);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn upgrade_and_call_should_fail_when_not_default_admin(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    not_role_admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![].span(),
            token_owner,
            eid.eid,
        );

    let new_class_hash = declare("MockExecutor").unwrap_syscall().contract_class().class_hash;

    // Attempt to upgrade and call
    // Caller is not the role admin
    cheat_caller_address_once(executor, not_role_admin);
    let res = safe_dispatcher.upgrade_and_call(*new_class_hash, 0, array![].span());

    // Check that the upgrade fails because the caller is not the role admin
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

///////////////////
// Execute tests //
///////////////////

#[test]
#[fuzzer(runs: 10)]
fn execute_should_succeed_with_packet_delivered_event(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    receiver: ContractAddress,
    price_feed: ContractAddress,
) {
    let eid = eid.eid;
    let ExecutorTest {
        executor, dispatcher, endpoint, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            endpoint_owner,
            eid,
        );

    // ExecuteParams - values are not important because we're mocking the endpoint
    let params = create_mock_execute_params(eid, receiver);
    let origin = params.origin.clone();

    let mut spy = spy_events();

    // Execute
    cheat_caller_address_once(executor, admin);
    dispatcher.execute(params);

    // Check that endpoint event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint,
                    MockEndpointV2::Event::PacketDelivered(
                        endpoint_events::PacketDelivered { origin, receiver },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn execute_should_fail_with_alert_event(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    receiver: ContractAddress,
    price_feed: ContractAddress,
) {
    let eid = eid.eid;
    let ExecutorTest {
        executor, dispatcher, endpoint, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            endpoint_owner,
            eid,
        );

    // ExecuteParams - values are not important because we're mocking the endpoint
    let params = create_mock_execute_params(eid, receiver);
    let origin = params.origin.clone();

    // Set the endpoint to fail on lz_receive
    let mut endpoint_dispatcher = MockEndpointV2HelpersDispatcher { contract_address: endpoint };
    endpoint_dispatcher.set_receive_should_fail(true);

    let mut spy = spy_events();

    // Execute
    cheat_caller_address_once(executor, admin);
    dispatcher.execute(params.clone());

    // Check that endpoint event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint,
                    MockEndpointV2::Event::LzReceiveAlert(
                        endpoint_events::LzReceiveAlert {
                            origin,
                            executor,
                            receiver,
                            guid: params.guid,
                            gas: 0,
                            value: params.value,
                            message: params.message,
                            extra_data: params.extra_data,
                            reason: array!['Mock receive failed'],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn execute_should_fail_when_not_admin(
    role_admin: RoleAdmin,
    endpoint_owner: ContractAddress,
    not_admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    receiver: ContractAddress,
    eid: Eid,
) {
    let eid = eid.eid;
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![].span(),
            token_owner,
            eid,
        );

    // ExecuteParams values are not important because we're mocking the endpoint
    let params = create_mock_execute_params(eid, receiver);

    // Attempt to execute
    // Caller does not have admin role
    cheat_caller_address_once(executor, not_admin);
    let res = safe_dispatcher.execute(params);

    // Check that the execute fails because the caller does not have the admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn execute_should_fail_when_approval_fails(
    role_admin: RoleAdmin,
    endpoint_owner: ContractAddress,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    receiver: ContractAddress,
    eid: Eid,
) {
    let eid = eid.eid;
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_dispatcher, token, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![admin].span(),
            token_owner,
            eid,
        );

    // ExecuteParams values are not important because we're mocking the endpoint
    let params = ExecuteParams {
        value: 1, // just has to be > 0 to trigger approve
        receiver,
        guid: Default::default(),
        message: Default::default(),
        extra_data: Default::default(),
        gas_limit: Default::default(),
        origin: Origin { src_eid: eid, ..Default::default() },
    };

    // Approve fails
    start_mock_call(token, selector!("approve"), false);
    cheat_caller_address_once(executor, admin);
    let res = safe_dispatcher.execute(params);

    // Check that the execute fails because the approve failed
    assert_panic_with_error(res, errors::err_approval_failed());
}

///////////////////
// Compose tests //
///////////////////

#[test]
#[fuzzer(runs: 10)]
fn compose_should_succeed_with_compose_delivered_event(
    token: ContractAddress, sender: ContractAddress, receiver: ContractAddress,
) {
    // Deploy mock contracts
    let MessagingComposerMock {
        composer, dispatcher: composer_dispatcher, ..,
    } = deploy_mock_messaging_composer(token);
    let ExecutorMock {
        dispatcher, ..,
    } = deploy_mock_executor(ZERO_ADDRESS, ZERO_ADDRESS, composer);

    // Set the messaging composer to be mock
    composer_dispatcher.set_is_real(false);

    // ComposeParams values are not important because we're mocking the endpoint
    let params = create_mock_compose_params(sender, receiver);

    let mut spy = spy_events();

    // Compose
    // Mock executor does not have access control
    dispatcher.compose(params.clone());

    // Check that compose delivered event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    composer,
                    MockMessagingComposer::Event::MessagingComposerEvent(
                        MessagingComposerComponent::Event::ComposeDelivered(
                            ComposeDelivered {
                                from: params.sender,
                                to: params.receiver,
                                guid: params.guid,
                                index: params.index,
                            },
                        ),
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn compose_should_fail_with_lz_compose_alert_event(
    token: ContractAddress, sender: ContractAddress, receiver: ContractAddress,
) {
    // Deploy mock contracts
    let MessagingComposerMock {
        composer, dispatcher: composer_dispatcher, ..,
    } = deploy_mock_messaging_composer(token);
    let ExecutorMock {
        dispatcher, ..,
    } = deploy_mock_executor(ZERO_ADDRESS, ZERO_ADDRESS, composer);

    // Set the messaging composer to be mock and fail on lz_compose
    composer_dispatcher.set_is_real(false);
    composer_dispatcher.set_should_compose_fail(true);

    // ComposeParams values are not important because we're mocking the endpoint
    let params = create_mock_compose_params(sender, receiver);

    let mut spy = spy_events();

    // Compose
    // Mock executor does not have access control
    dispatcher.compose(params.clone());

    // Check that compose alert event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    composer,
                    MockMessagingComposer::Event::MessagingComposerEvent(
                        MessagingComposerComponent::Event::LzComposeAlert(
                            LzComposeAlert {
                                from: params.sender,
                                to: params.receiver,
                                executor: ZERO_ADDRESS,
                                guid: params.guid,
                                index: params.index,
                                gas: 0,
                                value: params.value,
                                message: params.message,
                                extra_data: params.extra_data,
                                reason: array!['MockComposer: lz_compose failed'],
                            },
                        ),
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn compose_should_fail_when_not_admin(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    not_admin: ContractAddress,
    token_owner: ContractAddress,
    sender: ContractAddress,
    receiver: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            ZERO_ADDRESS,
            role_admin,
            array![].span(),
            token_owner,
            eid.eid,
        );

    // ComposeParams values are not important because we're mocking the endpoint
    let params = create_mock_compose_params(sender, receiver);

    // Attempt to compose
    // Caller does not have admin role
    cheat_caller_address_once(executor, not_admin);
    let res = safe_dispatcher.compose(params);

    // Check that the compose fails because the caller does not have the admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn compose_should_fail_when_approval_fails(
    role_admin: RoleAdmin,
    endpoint_owner: ContractAddress,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    sender: ContractAddress,
    receiver: ContractAddress,
    eid: Eid,
) {
    let eid = eid.eid;
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, safe_dispatcher, token, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin,
            array![admin].span(),
            token_owner,
            eid,
        );

    // ComposeParams values are not important because we're mocking the endpoint
    let params = ComposeParams {
        value: 1, // just has to be > 0 to trigger approve
        sender,
        receiver,
        guid: Default::default(),
        index: Default::default(),
        message: Default::default(),
        extra_data: Default::default(),
        gas_limit: Default::default(),
    };

    // Approve fails
    start_mock_call(token, selector!("approve"), false);
    cheat_caller_address_once(executor, admin);
    let res = safe_dispatcher.compose(params);

    // Check that the compose fails because the approve failed
    assert_panic_with_error(res, errors::err_approval_failed());
}

///////////////////////
// Native drop tests //
///////////////////////

#[test]
#[fuzzer(runs: 10)]
fn native_drop_to_no_receiver_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    origin: Origin,
    oapp: ContractAddress,
) {
    let ExecutorTest {
        executor, dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );

    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher.native_drop(origin.clone(), oapp, array![]);

    // Check that native drop applied event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin,
                            dst_eid: eid.eid,
                            oapp,
                            native_drop_params: array![],
                            success: array![],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_to_single_receiver_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    origin: Origin,
    oapp: ContractAddress,
    token_receiver: ContractAddress,
    token_amount: u8,
) {
    let token_amount = token_amount.into() + 1;
    let ExecutorTest {
        executor, dispatcher, token_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );

    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher
        .native_drop(
            origin.clone(),
            oapp,
            array![NativeDropParams { receiver: token_receiver, amount: token_amount }],
        );

    assert_eq(token_dispatcher.balance_of(token_receiver), token_amount);

    // Check that native drop applied event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin,
                            dst_eid: eid.eid,
                            oapp,
                            native_drop_params: array![
                                NativeDropParams { receiver: token_receiver, amount: token_amount },
                            ],
                            success: array![true],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_to_two_receivers_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    origin: Origin,
    oapp: ContractAddress,
    token_receiver_1: ContractAddress,
    token_receiver_2: ContractAddress,
    token_amount_1: u8,
    token_amount_2: u8,
) {
    let token_amount_1 = token_amount_1.into();
    let token_amount_2 = token_amount_2.into();
    let ExecutorTest {
        executor, dispatcher, token_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );

    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher
        .native_drop(
            origin.clone(),
            oapp,
            array![
                NativeDropParams { receiver: token_receiver_1, amount: token_amount_1 },
                NativeDropParams { receiver: token_receiver_2, amount: token_amount_2 },
            ],
        );

    assert_eq(token_dispatcher.balance_of(token_receiver_1), token_amount_1);
    assert_eq(token_dispatcher.balance_of(token_receiver_2), token_amount_2);

    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin,
                            dst_eid: eid.eid,
                            oapp,
                            native_drop_params: array![
                                NativeDropParams {
                                    receiver: token_receiver_1, amount: token_amount_1,
                                },
                                NativeDropParams {
                                    receiver: token_receiver_2, amount: token_amount_2,
                                },
                            ],
                            success: array![true, true],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_with_insufficient_balance_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    origin: Origin,
    oapp: ContractAddress,
    token_receiver: ContractAddress,
    token_amount: u8,
    sink: ContractAddress,
) {
    // Make the token amount always non-zero to fail the native token transfer.
    let token_amount = token_amount.into() + 1;
    let ExecutorTest {
        executor, dispatcher, token, token_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );

    // Drain all tokens from the executor.
    let balance = token_dispatcher.balance_of(executor);
    cheat_caller_address_once(token, executor);
    token_dispatcher.transfer(sink, balance);
    assert_eq(token_dispatcher.balance_of(executor), 0);

    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher
        .native_drop(
            origin.clone(),
            oapp,
            array![NativeDropParams { receiver: token_receiver, amount: token_amount }],
        );

    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin,
                            dst_eid: eid.eid,
                            oapp,
                            native_drop_params: array![
                                NativeDropParams { receiver: token_receiver, amount: token_amount },
                            ],
                            success: array![false],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_with_partial_transfer_success_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    origin: Origin,
    oapp: ContractAddress,
    token_receiver_1: ContractAddress,
    token_receiver_2: ContractAddress,
) {
    let ExecutorTest {
        executor, dispatcher, token_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );

    // We transfer a little more than half of balance of the executor to two native drop receivers.
    let token_amount = token_dispatcher.balance_of(executor) / 2 + 1;
    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher
        .native_drop(
            origin.clone(),
            oapp,
            array![
                NativeDropParams { receiver: token_receiver_1, amount: token_amount },
                NativeDropParams { receiver: token_receiver_2, amount: token_amount },
            ],
        );

    assert_eq(token_dispatcher.balance_of(token_receiver_1), token_amount);
    assert_eq(token_dispatcher.balance_of(token_receiver_2), 0);

    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin,
                            dst_eid: eid.eid,
                            oapp,
                            native_drop_params: array![
                                NativeDropParams {
                                    receiver: token_receiver_1, amount: token_amount,
                                },
                                NativeDropParams {
                                    receiver: token_receiver_2, amount: token_amount,
                                },
                            ],
                            success: array![true, false],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_should_fail_when_not_admin(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    origin: Origin,
    oapp: ContractAddress,
    user: ContractAddress,
) {
    let ExecutorTest {
        executor, safe_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![].span(),
            token_owner,
            eid.eid,
        );

    cheat_caller_address_once(executor, user);
    let result = safe_dispatcher.native_drop(origin, oapp, array![]);

    assert_panic_with_felt_error(result, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_and_execute_with_no_native_drop_receiver_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    oapp: ContractAddress,
) {
    let ExecutorTest {
        executor, dispatcher, endpoint, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );
    let execute_params = create_mock_execute_params(eid.eid, oapp);
    let origin = execute_params.origin.clone();

    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher.native_drop_and_execute(array![], execute_params);

    let events = spy.get_events();

    assert!(events.events.len() == 2);
    assert!(
        events
            .is_emitted(
                executor,
                @Executor::Event::NativeDropApplied(
                    NativeDropApplied {
                        origin: origin.clone(),
                        dst_eid: eid.eid,
                        oapp,
                        native_drop_params: array![],
                        success: array![],
                    },
                ),
            ),
    );
    assert!(
        events
            .is_emitted(
                endpoint,
                @MockEndpointV2::Event::PacketDelivered(
                    endpoint_events::PacketDelivered { origin, receiver: oapp },
                ),
            ),
    );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_and_execute_with_single_native_drop_receiver_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    oapp: ContractAddress,
    token_owner: ContractAddress,
    token_receiver: ContractAddress,
    token_amount: u8,
) {
    let ExecutorTest {
        executor, dispatcher, endpoint, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );
    let execute_params = create_mock_execute_params(eid.eid, oapp);
    let origin = execute_params.origin.clone();
    let native_drop_params = array![
        NativeDropParams { receiver: token_receiver, amount: token_amount.into() + 1 },
    ];

    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher.native_drop_and_execute(native_drop_params.clone(), execute_params);

    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin: origin.clone(),
                            dst_eid: eid.eid,
                            oapp,
                            native_drop_params,
                            success: array![true],
                        },
                    ),
                ),
            ],
        );
    spy
        .assert_emitted(
            @array![
                (
                    endpoint,
                    MockEndpointV2::Event::PacketDelivered(
                        endpoint_events::PacketDelivered { origin, receiver: oapp },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_and_execute_with_insufficient_balance_should_succeed(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    oapp: ContractAddress,
    token_owner: ContractAddress,
    token_receiver: ContractAddress,
    token_amount: u8,
    sink: ContractAddress,
) {
    let ExecutorTest {
        executor, dispatcher, token, token_dispatcher, endpoint, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![admin].span(),
            token_owner,
            eid.eid,
        );
    let execute_params = create_mock_execute_params(eid.eid, oapp);
    let origin = execute_params.origin.clone();
    let native_drop_params = array![
        NativeDropParams { receiver: token_receiver, amount: token_amount.into() + 1 },
    ];

    // Drain all tokens from the executor.
    let balance = token_dispatcher.balance_of(executor);
    cheat_caller_address_once(token, executor);
    token_dispatcher.transfer(sink, balance);
    assert_eq(token_dispatcher.balance_of(executor), 0);

    let mut spy = spy_events();

    cheat_caller_address_once(executor, admin);
    dispatcher.native_drop_and_execute(native_drop_params.clone(), execute_params);

    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin: origin.clone(),
                            dst_eid: eid.eid,
                            oapp,
                            native_drop_params,
                            success: array![false],
                        },
                    ),
                ),
            ],
        );
    // Even when native drops fail, the executor is expected to execute a message and succeed the
    // whole transaction.
    spy
        .assert_emitted(
            @array![
                (
                    endpoint,
                    MockEndpointV2::Event::PacketDelivered(
                        endpoint_events::PacketDelivered { origin, receiver: oapp },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn native_drop_and_execute_should_fail_when_not_admin(
    endpoint_owner: ContractAddress,
    eid: Eid,
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    token_owner: ContractAddress,
    receiver: ContractAddress,
    user: ContractAddress,
) {
    let ExecutorTest {
        executor, safe_dispatcher, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            price_feed,
            role_admin.address,
            array![].span(),
            token_owner,
            eid.eid,
        );
    let execute_params = create_mock_execute_params(eid.eid, receiver);

    cheat_caller_address_once(executor, user);
    let result = safe_dispatcher.native_drop_and_execute(array![], execute_params);

    assert_panic_with_felt_error(result, AccessControlComponent::Errors::MISSING_ROLE);
}

////////////////////
// Pausable tests //
////////////////////

/// Default admin can pause the contract
#[test]
#[fuzzer(runs: 10)]
fn pause_and_unpause_succeeds_when_default_admin(
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    endpoint: ContractAddress,
    token_owner: ContractAddress,
) {
    let role_admin = role_admin.address;
    let ExecutorTest {
        executor, dispatcher, access_control, ..,
    } =
        deploy_executor(
            endpoint, array![].span(), price_feed, role_admin, array![].span(), token_owner, EID,
        );

    let mut spy = spy_events();

    // Caller has default admin role
    assert!(
        access_control.has_role(DEFAULT_ADMIN_ROLE, role_admin),
        "Role admin should have default admin role",
    );
    cheat_caller_address_once(executor, role_admin);
    dispatcher.pause();

    // Check that contract is paused
    let pausable_dispatcher = IPausableDispatcher { contract_address: executor };
    assert(pausable_dispatcher.is_paused(), 'Contract should be paused');

    // Verify Paused event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    PausableComponent::Event::Paused(
                        PausableComponent::Paused { account: role_admin },
                    ),
                ),
            ],
        );

    // Unpause the contract
    cheat_caller_address_once(executor, role_admin);
    dispatcher.unpause();

    // Check that contract is unpaused
    assert(!pausable_dispatcher.is_paused(), 'Contract should be unpaused');

    // Verify Unpaused event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    executor,
                    PausableComponent::Event::Unpaused(
                        PausableComponent::Unpaused { account: role_admin },
                    ),
                ),
            ],
        );
}

/// Non-default admin cannot pause the contract
#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn pause_and_unpause_fails_when_not_default_admin(
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    not_default_admin: ContractAddress,
    endpoint: ContractAddress,
    token_owner: ContractAddress,
) {
    // Ensure that role_admin and not_default_admin are different
    let role_admin = role_admin.address;
    if role_admin == not_default_admin {
        return;
    }

    let ExecutorTest {
        executor, safe_dispatcher, access_control, ..,
    } =
        deploy_executor(
            endpoint, array![].span(), price_feed, role_admin, array![].span(), token_owner, EID,
        );

    // Caller does not have default admin role
    assert!(
        !access_control.has_role(DEFAULT_ADMIN_ROLE, not_default_admin),
        "Caller should not have default admin role",
    );
    cheat_caller_address_once(executor, not_default_admin);
    let res = safe_dispatcher.pause();

    // Should panic with missing role error because not_default_admin does not have default admin
    // role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Check that contract is not paused
    let pausable_dispatcher = IPausableDispatcher { contract_address: executor };
    assert(!pausable_dispatcher.is_paused(), 'Contract should not be paused');

    // Pause the contract with role admin
    cheat_caller_address_once(executor, role_admin);
    safe_dispatcher.pause().unwrap();

    // Check that contract is not paused
    let pausable_dispatcher = IPausableDispatcher { contract_address: executor };
    assert(pausable_dispatcher.is_paused(), 'Contract should be paused');

    // Check that can't unpause the contract as not default admin
    cheat_caller_address_once(executor, not_default_admin);
    let res = safe_dispatcher.unpause();
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Check that contract is still paused
    let pausable_dispatcher = IPausableDispatcher { contract_address: executor };
    assert(pausable_dispatcher.is_paused(), 'Contract should still be paused');
}

//////////////////////////
// Implementation tests //
//////////////////////////

#[test]
fn impl_layer_zero_worker_interface() {
    let endpoint_owner = 'endpoint owner'.try_into().unwrap();
    let ExecutorTest {
        executor, ..,
    } =
        deploy_executor(
            endpoint_owner,
            array![].span(),
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            array![].span(),
            endpoint_owner,
            EID,
        );

    /// Runtime check that the executor implements the ILayerZeroWorker interface
    ILayerZeroWorkerDispatcher { contract_address: executor };
}
