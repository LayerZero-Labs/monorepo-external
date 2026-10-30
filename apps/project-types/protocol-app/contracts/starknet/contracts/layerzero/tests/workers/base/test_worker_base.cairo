//! Base worker tests

use core::num::traits::Zero;
use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::workers::base::base::WorkerBaseComponent;
use layerzero::workers::base::errors::err_transfer_failed;
use layerzero::workers::base::events::{
    DefaultMultiplierBpsSet, FeeWithdrawn, SupportedOptionTypeSet, WorkerFeeLibSet,
};
use layerzero::workers::base::interface::{
    IWorkerBaseDispatcherTrait, IWorkerBaseSafeDispatcherTrait,
};
use openzeppelin::access::accesscontrol::AccessControlComponent;
use openzeppelin::token::erc20::ERC20Component::{Event as ERC20Event, Transfer};
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::fuzzable::{FuzzableU16, FuzzableU256};
use snforge_std::{
    EventSpyAssertionsTrait, spy_events, start_cheat_caller_address, start_mock_call,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::constants::assert_eq;
use crate::fuzzable::contract_address::{FuzzableContractAddress, FuzzableContractAddresses};
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::role_admin::{FuzzableRoleAdmin, RoleAdmin};
use crate::workers::base::utils::{
    ERC20Mock, WorkerBaseMock, deploy_mock_erc20, deploy_worker_base,
    deploy_worker_base_with_additional_roles,
};

//////////////////////////
// Initialization tests //
//////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn initialization_sets_price_feed(role_admin: ContractAddress, price_feed: ContractAddress) {
    let WorkerBaseMock { dispatcher, .. } = deploy_worker_base(price_feed, role_admin);
    assert(dispatcher.get_price_feed() == price_feed, 'Price feed should be set');
}

//////////////////////
// Price feed tests //
//////////////////////

#[test]
#[fuzzer(runs: 10)]
fn set_price_feed_succeeds_when_admin(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    new_price_feed: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    // Set price feed
    // Caller has admin role
    cheat_caller_address_once(worker, admin);
    dispatcher.set_price_feed(new_price_feed);

    // Check that price feed is set
    assert(dispatcher.get_price_feed() == new_price_feed, 'Price feed should be set');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn set_price_feed_fails_when_not_admin(
    role_admin: RoleAdmin, not_admin: ContractAddress, price_feed: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock { worker, safe_dispatcher, .. } = deploy_worker_base(price_feed, role_admin);

    // Attempt to set price feed
    // Caller does not have admin role
    cheat_caller_address_once(worker, role_admin);
    let res = safe_dispatcher.set_price_feed(price_feed);

    // Should panic with missing role error because role_admin does not have admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Attempt to set price feed
    // Caller does not have admin role
    cheat_caller_address_once(worker, not_admin);
    let res = safe_dispatcher.set_price_feed(price_feed);

    // Should panic with missing role error because not_admin does not have admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn set_price_feed_fails_when_msg_lib(
    role_admin: RoleAdmin, msg_lib: ContractAddress, price_feed: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, safe_dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![msg_lib].span(), price_feed, role_admin, array![].span(),
        );

    // Attempt to set price feed
    // Caller has msg lib role
    cheat_caller_address_once(worker, msg_lib);
    let res = safe_dispatcher.set_price_feed(price_feed);

    // Should panic with missing role error because msg_lib does not have admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

#[test]
#[fuzzer(runs: 10)]
fn set_multiple_price_feeds_succeeds(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    first_new_price_feed: ContractAddress,
    second_new_price_feed: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    // Caller has admin role
    start_cheat_caller_address(worker, admin);

    // First price feed update
    dispatcher.set_price_feed(first_new_price_feed);
    let price_feed = dispatcher.get_price_feed();
    assert(price_feed == first_new_price_feed, 'First update should succeed');

    // Second price feed update
    dispatcher.set_price_feed(second_new_price_feed);
    let price_feed = dispatcher.get_price_feed();
    assert(price_feed == second_new_price_feed, 'Second update should succeed');

    stop_cheat_caller_address(worker);
}

/////////////////////////////////
// Supported option type tests //
/////////////////////////////////

/// An admin can set the supported option type for an EID - corresponding event is emitted
#[test]
#[fuzzer(runs: 10)]
fn set_supported_option_type_succeeds_when_admin(
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    admin: ContractAddress,
    eid: Eid,
    option_type: ByteArray,
) {
    let eid = eid.eid;
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    let mut spy = spy_events();

    // Caller has admin role
    cheat_caller_address_once(worker, admin);
    dispatcher.set_supported_option_type(eid, option_type.clone());

    // Check that supported option type is set
    assert!(
        dispatcher.get_supported_option_type(eid) == option_type,
        "Supported option type should be set",
    );

    // Verify SupportedOptionTypeSet event was emitted
    let expected_event = WorkerBaseComponent::Event::SupportedOptionTypeSet(
        SupportedOptionTypeSet { eid, option_type },
    );
    spy.assert_emitted(@array![(worker, expected_event)]);
}

/// A non-admin cannot set the supported option type for an EID - no event is emitted
#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn set_supported_option_type_fails_when_not_admin(
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    not_admin: ContractAddress,
    eid: Eid,
    option_type: ByteArray,
) {
    let eid = eid.eid;
    let role_admin = role_admin.address;
    let WorkerBaseMock { worker, safe_dispatcher, .. } = deploy_worker_base(price_feed, role_admin);

    let mut spy = spy_events();

    // Caller does not have admin role
    cheat_caller_address_once(worker, not_admin);
    let res = safe_dispatcher.set_supported_option_type(eid, option_type.clone());

    // Should panic with missing role error because not_admin does not have admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Check that supported option type is not set
    assert!(
        safe_dispatcher.get_supported_option_type(eid).unwrap() == Default::default(),
        "Supported option type should not be set",
    );

    // Verify SupportedOptionTypeSet event was not emitted
    let event = WorkerBaseComponent::Event::SupportedOptionTypeSet(
        SupportedOptionTypeSet { eid, option_type },
    );
    spy.assert_not_emitted(@array![(worker, event)]);
}

////////////////////////////////
// Set default multiplier bps //
////////////////////////////////

/// An admin can set the default multiplier basis points - corresponding event is emitted
#[test]
#[fuzzer(runs: 10)]
fn set_default_multiplier_bps_succeeds_when_admin(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    default_multiplier_bps: u16,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    let mut spy = spy_events();

    // Caller has admin role
    cheat_caller_address_once(worker, admin);
    dispatcher.set_default_multiplier_bps(default_multiplier_bps);

    // Check that default multiplier bps is set
    assert!(
        dispatcher.get_default_multiplier_bps() == default_multiplier_bps,
        "Default multiplier bps should be set",
    );

    // Verify DefaultMultiplierBpsSet event was emitted
    let expected_event = WorkerBaseComponent::Event::DefaultMultiplierBpsSet(
        DefaultMultiplierBpsSet { default_multiplier_bps },
    );
    spy.assert_emitted(@array![(worker, expected_event)]);
}

/// A non-admin cannot set the default multiplier basis points - no event is emitted
#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn set_default_multiplier_bps_fails_when_not_admin(
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    not_admin: ContractAddress,
    default_multiplier_bps: u16,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock { worker, safe_dispatcher, .. } = deploy_worker_base(price_feed, role_admin);

    let mut spy = spy_events();

    // Caller does not have admin role
    cheat_caller_address_once(worker, not_admin);
    let res = safe_dispatcher.set_default_multiplier_bps(default_multiplier_bps);

    // Should panic with missing role error because not_admin does not have admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Verify DefaultMultiplierBpsSet event was not emitted
    let event = WorkerBaseComponent::Event::DefaultMultiplierBpsSet(
        DefaultMultiplierBpsSet { default_multiplier_bps },
    );
    spy.assert_not_emitted(@array![(worker, event)]);
}

////////////////////////
// Withdraw fee tests //
////////////////////////

/// Admin can withdraw fee
#[test]
#[fuzzer(runs: 10)]
fn withdraw_fee_succeeds_when_correct(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    token_holder: ContractAddress,
    recipient: ContractAddress,
    amount: u256,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    // Give token_holder ERC20 tokens
    const MIN_AMOUNT: u256 = 1_000;
    const MAX_AMOUNT: u256 = 9_000;
    let amount = MIN_AMOUNT + amount % MAX_AMOUNT;
    let ERC20Mock { token, token_dispatcher } = deploy_mock_erc20(amount, token_holder);

    // Holder transfers tokens to worker
    // Caller has tokens
    cheat_caller_address_once(token, token_holder);
    token_dispatcher.transfer(worker, amount);

    // Check that worker received tokens
    assert(token_dispatcher.balance_of(worker) == amount, 'Worker balance should be amount');

    let mut spy = spy_events();

    // Admin withdraws fee
    // Caller has admin role
    let withdraw_amount = amount / 2;
    cheat_caller_address_once(worker, admin);
    dispatcher.withdraw_fee(token, recipient, withdraw_amount);

    // Verify balances
    assert!(
        token_dispatcher.balance_of(recipient) == withdraw_amount,
        "Recipient balance should be withdraw amount",
    );
    assert!(
        token_dispatcher.balance_of(worker) == amount - withdraw_amount,
        "Worker balance should be remaining",
    );

    // Verify WithdrawFee event was emitted
    let expected_event = WorkerBaseComponent::Event::FeeWithdrawn(
        FeeWithdrawn { to: recipient, amount: withdraw_amount },
    );
    spy.assert_emitted(@array![(worker, expected_event)]);

    // Verify ERC20 transfer event was emitted
    let erc20_event = ERC20Event::Transfer(
        Transfer { from: worker, to: recipient, value: withdraw_amount },
    );
    spy.assert_emitted(@array![(token, erc20_event)]);
}

/// Fees cannot be withdrawn if
/// - caller is not admin
/// - caller is admin but trying to withdraw more than worker balance
#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn withdraw_fee_fails_when_incorrect(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    not_admin: ContractAddress,
    price_feed: ContractAddress,
    token_holder: ContractAddress,
    recipient: ContractAddress,
    amount: u256,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, safe_dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    // Give token_holder ERC20 tokens
    const MIN_AMOUNT: u256 = 1_000;
    const MAX_AMOUNT: u256 = 9_000;
    let amount = MIN_AMOUNT + amount % MAX_AMOUNT;
    let ERC20Mock { token, token_dispatcher } = deploy_mock_erc20(amount, token_holder);

    // Holder transfers tokens to worker
    // Caller has tokens
    cheat_caller_address_once(token, token_holder);
    token_dispatcher.transfer(worker, amount);

    // Check that worker received tokens
    assert(token_dispatcher.balance_of(worker) == amount, 'Worker balance should be amount');

    ///////////////////////////////////
    // Non-admin cannot withdraw fee //
    ///////////////////////////////////

    // Non-admin attempts to withdraw fee
    // Caller does not have admin role
    let withdraw_amount = amount / 2;
    cheat_caller_address_once(worker, not_admin);
    let res = safe_dispatcher.withdraw_fee(token, recipient, withdraw_amount);

    // Should panic with missing role error because not_admin does not have the admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Verify balances are unchanged
    assert(token_dispatcher.balance_of(recipient) == 0, 'Recipient balance should be 0');
    assert(token_dispatcher.balance_of(worker) == amount, 'Worker balance should be amount');

    //////////////////////////////////////////////
    // Cannot withdraw more than worker balance //
    //////////////////////////////////////////////

    // Admin attempts to withdraw more than worker balance
    let withdraw_amount = amount + 1;

    start_mock_call(token, selector!("transfer"), false);
    cheat_caller_address_once(worker, admin);
    let res = safe_dispatcher.withdraw_fee(token, recipient, withdraw_amount);

    // Should panic with insufficient balance error because admin is trying to withdraw more than
    // worker balance
    assert_panic_with_error(res, err_transfer_failed());

    // Verify balances are unchanged
    assert(token_dispatcher.balance_of(recipient) == 0, 'Recipient balance should be 0');
    assert(token_dispatcher.balance_of(worker) == amount, 'Worker balance should be amount');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn withdraw_fee_fails_when_transfer_fails(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    not_admin: ContractAddress,
    price_feed: ContractAddress,
    token_holder: ContractAddress,
    recipient: ContractAddress,
    amount: u256,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, safe_dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    const MIN_AMOUNT: u256 = 1_000;
    const MAX_AMOUNT: u256 = 9_000;
    let amount = MIN_AMOUNT + amount % MAX_AMOUNT;
    let ERC20Mock { token, .. } = deploy_mock_erc20(amount, token_holder);

    // Transfer fails
    start_mock_call(token, selector!("transfer"), false);
    cheat_caller_address_once(worker, admin);
    let res = safe_dispatcher.withdraw_fee(token, recipient, amount);

    // Check withdraw fee fails
    assert_panic_with_error(res, err_transfer_failed());
}

//////////////////////////
// Worker fee_lib tests //
//////////////////////////

/// An admin can set the worker fee_lib address - corresponding event is emitted
#[test]
#[fuzzer(runs: 10)]
fn set_worker_fee_lib_succeeds_when_admin(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    initial_worker_fee_lib: ContractAddress,
    new_worker_fee_lib: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    // Set initial worker fee_lib
    cheat_caller_address_once(worker, admin);
    dispatcher.set_worker_fee_lib(initial_worker_fee_lib);

    let mut spy = spy_events();

    // Set new worker fee_lib
    cheat_caller_address_once(worker, admin);
    dispatcher.set_worker_fee_lib(new_worker_fee_lib);

    // Check that worker fee_lib is set
    assert!(dispatcher.get_worker_fee_lib() == new_worker_fee_lib, "Worker fee_lib should be set");

    // Verify WorkerFeeLibSet event was emitted
    let expected_event = WorkerBaseComponent::Event::WorkerFeeLibSet(
        WorkerFeeLibSet {
            old_worker_fee_lib: initial_worker_fee_lib, new_worker_fee_lib: new_worker_fee_lib,
        },
    );
    spy.assert_emitted(@array![(worker, expected_event)]);
}

/// A non-admin cannot set the worker fee_lib address - no event is emitted
#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn set_worker_fee_lib_fails_when_not_admin(
    role_admin: RoleAdmin,
    price_feed: ContractAddress,
    not_admin: ContractAddress,
    worker_fee_lib: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock { worker, safe_dispatcher, .. } = deploy_worker_base(price_feed, role_admin);

    let mut spy = spy_events();

    // Caller does not have admin role
    cheat_caller_address_once(worker, not_admin);
    let res = safe_dispatcher.set_worker_fee_lib(worker_fee_lib);

    // Should panic with missing role error because not_admin does not have admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);

    // Check that worker fee_lib is not set (should be zero address by default)
    assert!(
        safe_dispatcher.get_worker_fee_lib().unwrap().is_zero(), "Worker fee_lib should not be set",
    );

    // Verify WorkerFeeLibSet event was not emitted
    let event = WorkerBaseComponent::Event::WorkerFeeLibSet(
        WorkerFeeLibSet { old_worker_fee_lib: ZERO_ADDRESS, new_worker_fee_lib: worker_fee_lib },
    );
    spy.assert_not_emitted(@array![(worker, event)]);
}

/// A message lib cannot set the worker fee_lib address
#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn set_worker_fee_lib_fails_when_msg_lib(
    role_admin: RoleAdmin,
    msg_lib: ContractAddress,
    price_feed: ContractAddress,
    worker_fee_lib: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, safe_dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![msg_lib].span(), price_feed, role_admin, array![].span(),
        );

    // Attempt to set worker fee_lib
    // Caller has msg lib role
    cheat_caller_address_once(worker, msg_lib);
    let res = safe_dispatcher.set_worker_fee_lib(worker_fee_lib);

    // Should panic with missing role error because msg_lib does not have admin role
    assert_panic_with_felt_error(res, AccessControlComponent::Errors::MISSING_ROLE);
}

/// Admin can set multiple worker fee_lib addresses successfully
#[test]
#[fuzzer(runs: 10)]
fn set_multiple_worker_fee_lib_succeeds(
    role_admin: RoleAdmin,
    admin: ContractAddress,
    price_feed: ContractAddress,
    first_worker_fee_lib: ContractAddress,
    second_worker_fee_lib: ContractAddress,
) {
    let role_admin = role_admin.address;
    let WorkerBaseMock {
        worker, dispatcher, ..,
    } =
        deploy_worker_base_with_additional_roles(
            array![].span(), price_feed, role_admin, array![admin].span(),
        );

    // First worker fee_lib update
    // Caller has admin role
    cheat_caller_address_once(worker, admin);
    dispatcher.set_worker_fee_lib(first_worker_fee_lib);

    let fee_lib = dispatcher.get_worker_fee_lib();
    assert(fee_lib == first_worker_fee_lib, 'First update should succeed');

    // Second worker fee_lib update
    // Caller has admin role
    cheat_caller_address_once(worker, admin);
    dispatcher.set_worker_fee_lib(second_worker_fee_lib);

    let fee_lib = dispatcher.get_worker_fee_lib();
    assert(fee_lib == second_worker_fee_lib, 'Second update should succeed');
}

/// Get worker fee_lib returns zero address by default
#[test]
#[fuzzer(runs: 10)]
fn get_worker_fee_lib_returns_zero_by_default(role_admin: RoleAdmin, price_feed: ContractAddress) {
    let role_admin = role_admin.address;
    let WorkerBaseMock { dispatcher, .. } = deploy_worker_base(price_feed, role_admin);

    assert_eq(dispatcher.get_worker_fee_lib(), ZERO_ADDRESS);
}
