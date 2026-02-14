//! Treasury tests

use layerzero::common::constants::BPS_DENOMINATOR;
use layerzero::treasury::errors::{err_lz_token_not_enabled, err_transfer_failed};
use layerzero::treasury::events::BasisPointsUpdated;
use layerzero::treasury::interfaces::layerzero_treasury::{
    ILayerZeroTreasurySafeDispatcher, ILayerZeroTreasurySafeDispatcherTrait,
};
use layerzero::treasury::interfaces::treasury_admin::{
    ITreasuryAdminSafeDispatcher, ITreasuryAdminSafeDispatcherTrait,
};
use layerzero::treasury::treasury::Treasury;
use openzeppelin::access::ownable::interface::{IOwnableSafeDispatcher, IOwnableSafeDispatcherTrait};
use openzeppelin::token::erc20::ERC20Component::{Event as ERC20Event, Transfer};
use openzeppelin::token::erc20::interface::{IERC20SafeDispatcher, IERC20SafeDispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_mock_call,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::constants::assert_eq;
use crate::fuzzable::contract_address::{FuzzableContractAddress, FuzzableContractAddresses};
use crate::mocks::treasury::lz_token_fee_lib::{
    IMockLzTokenFeeLibAssertionDispatcher, IMockLzTokenFeeLibAssertionDispatcherTrait,
};
use crate::treasury::utils::deploy_mock_lz_token_fee_lib;

// Test constants
const OWNER: ContractAddress = 'owner'.try_into().unwrap();
const USER: ContractAddress = 'user'.try_into().unwrap();
const RECIPIENT: ContractAddress = 'recipient'.try_into().unwrap();

// Test values
const INITIAL_TOKEN_SUPPLY: u256 = 1000000_u256; // 1M tokens
const TEST_BASIS_POINTS: u256 = 500_u256; // 5%
const TEST_WORKER_FEE: u256 = 10000_u256;
const TEST_DST_EID: u32 = 102;
const TEST_EXPECTED_FEE: u32 = 500;

fn deploy_mock_erc20(initial_supply: u256, recipient: ContractAddress) -> IERC20SafeDispatcher {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let (address, _) = contract
        .deploy(@array![initial_supply.low.into(), initial_supply.high.into(), recipient.into()])
        .unwrap_syscall();

    IERC20SafeDispatcher { contract_address: address }
}

#[derive(Drop)]
struct TreasuryDeploy {
    address: ContractAddress,
    treasury: ILayerZeroTreasurySafeDispatcher,
    treasury_admin: ITreasuryAdminSafeDispatcher,
    ownable: IOwnableSafeDispatcher,
}

fn deploy_treasury() -> TreasuryDeploy {
    let contract = declare("Treasury").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![OWNER.into()]).unwrap_syscall();

    TreasuryDeploy {
        address,
        treasury: ILayerZeroTreasurySafeDispatcher { contract_address: address },
        treasury_admin: ITreasuryAdminSafeDispatcher { contract_address: address },
        ownable: IOwnableSafeDispatcher { contract_address: address },
    }
}

fn setup() -> (TreasuryDeploy, IERC20SafeDispatcher) {
    let native_token = deploy_mock_erc20(INITIAL_TOKEN_SUPPLY, USER);
    let treasury = deploy_treasury();

    (treasury, native_token)
}

fn setup_with_basis_points(basis_points: u256) -> (TreasuryDeploy, IERC20SafeDispatcher) {
    let (treasury, native_token) = setup();

    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_fee_bp(basis_points).unwrap_syscall();

    (treasury, native_token)
}

#[test]
fn test_constructor() {
    let (treasury, _) = setup();

    // Test that owner is set correctly
    assert_eq(treasury.ownable.owner().unwrap(), OWNER);

    // Test that basis points start at 0
    assert_eq(treasury.treasury_admin.get_fee_bp().unwrap(), 0);
}

#[test]
fn test_withdraw_tokens_as_owner() {
    let CUSTOM_BASIS_POINTS = 200;

    let (treasury, native_token) = setup_with_basis_points(CUSTOM_BASIS_POINTS);

    // First, get some tokens into the treasury by paying a fee
    // 1999.62 rounded down
    let expected_treasury_fee = 1_999;

    cheat_caller_address_once(native_token.contract_address, USER);
    native_token.transfer(treasury.address, expected_treasury_fee).unwrap();

    let mut spy = spy_events();
    // should be 999.5 => 999
    let withdraw_amount = expected_treasury_fee / 2;

    // Withdraw tokens as owner
    cheat_caller_address_once(treasury.address, OWNER);
    treasury
        .treasury_admin
        .withdraw_tokens(native_token.contract_address, RECIPIENT, withdraw_amount)
        .unwrap();

    // Verify balances
    let final_recipient_balance = native_token.balance_of(RECIPIENT).unwrap();
    let final_treasury_balance = native_token.balance_of(treasury.address).unwrap();

    assert_eq(final_recipient_balance, 999);
    assert_eq(final_treasury_balance, 1000);

    let expected_event = ERC20Event::Transfer(
        Transfer { from: treasury.address, to: RECIPIENT, value: withdraw_amount },
    );
    spy.assert_emitted(@array![(native_token.contract_address, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
fn test_withdraw_tokens_fails_as_non_owner(amount: u256) {
    let (treasury, native_token) = setup();

    cheat_caller_address_once(treasury.address, USER);
    let result = treasury
        .treasury_admin
        .withdraw_tokens(native_token.contract_address, RECIPIENT, amount);

    assert_panic_with_felt_error(result, 'Caller is not the owner');
}


#[test]
#[fuzzer(runs: 10)]
fn test_withdraw_tokens_fails_with_insufficient_balance(amount: u256) {
    let (treasury, native_token) = setup();

    cheat_caller_address_once(treasury.address, OWNER);
    let result = treasury
        .treasury_admin
        .withdraw_tokens(
            native_token.contract_address, RECIPIENT, amount + 1,
        ); // More than treasury has

    assert_panic_with_felt_error(result, 'ERC20: insufficient balance');
}

#[test]
fn test_withdraw_tokens_with_transfer_failure() {
    let (treasury, native_token) = setup();

    start_mock_call(native_token.contract_address, selector!("transfer"), false);

    cheat_caller_address_once(treasury.address, OWNER);
    let result = treasury
        .treasury_admin
        .withdraw_tokens(native_token.contract_address, RECIPIENT, 0);

    assert_panic_with_error(result, err_transfer_failed());
}

// =============================== Native token =================================

#[test]
#[fuzzer(runs: 10)]
fn test_get_native_fee_with_zero_basis_points(dst_eid: u32, worker_fee: u256) {
    let (treasury, _) = setup();

    let fee = treasury.treasury.get_fee(USER, dst_eid, worker_fee, false).unwrap();
    assert_eq(fee, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_native_fee_with_basis_points(dst_eid: u32, basis_points: u128) {
    const CUSTOM_WORKER_FEE: u256 = 1000_000_000;
    let basis_points = basis_points.into();

    let (treasury, _) = setup_with_basis_points(basis_points);

    let fee = treasury.treasury.get_fee(USER, dst_eid, CUSTOM_WORKER_FEE, false).unwrap();
    assert_eq(fee, 100_000 * basis_points);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_native_fee_edge_cases(dst_eid: u32, worker_fee: u128) {
    let (treasury, _) = setup_with_basis_points(10000); // 100%
    let worker_fee = worker_fee.into();

    // Test with 100% basis points
    let fee = treasury.treasury.get_fee(USER, dst_eid, worker_fee, false).unwrap();
    assert_eq(fee, worker_fee);

    // Test with zero total fee
    let fee_zero = treasury.treasury.get_fee(USER, dst_eid, 0, false).unwrap();
    assert_eq(fee_zero, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_simple_pay_native_fee(dst_eid: u32, worker_fee: u128) {
    let (treasury, _) = setup_with_basis_points(10000);
    let worker_fee = worker_fee.into();

    let fee = treasury.treasury.pay_fee(USER, dst_eid, worker_fee, false).unwrap();
    assert_eq(fee, worker_fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_native_fee_bp_as_owner(basis_points: u256) {
    let (treasury, _) = setup();

    let mut spy = spy_events();

    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_fee_bp(basis_points).unwrap();

    assert_eq(treasury.treasury_admin.get_fee_bp().unwrap(), basis_points);

    // Verify event was emitted
    let expected_event = Treasury::Event::BasisPointsUpdated(
        BasisPointsUpdated { old_bp: 0, new_bp: basis_points },
    );
    spy.assert_emitted(@array![(treasury.address, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_native_fee_bp_fails_as_non_owner(basis_points: u256) {
    let (treasury, _) = setup();

    cheat_caller_address_once(treasury.address, USER);
    let result = treasury.treasury_admin.set_fee_bp(basis_points);

    assert_panic_with_felt_error(result, 'Caller is not the owner');
}

#[test]
fn test_basis_points_update_affects_fee_calculation() {
    let (treasury, _) = setup();

    // Initially 0 basis points
    let initial_fee = treasury
        .treasury
        .get_fee(USER, TEST_DST_EID, TEST_WORKER_FEE, false)
        .unwrap();
    assert_eq(initial_fee, 0);

    const CUSTOM_WORKER_FEE: u256 = 8736482;
    const CUSTOM_BASIS_POINTS: u256 = 721;

    // Update basis points
    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_fee_bp(CUSTOM_BASIS_POINTS).unwrap();

    // Fee should now be calculated with new basis points
    // should be 629,900.3522 ~= 629,900
    let updated_fee = treasury
        .treasury
        .get_fee(USER, TEST_DST_EID, CUSTOM_WORKER_FEE, false)
        .unwrap();
    assert_eq(updated_fee, 629_900);
}

#[test]
#[fuzzer(runs: 10)]
fn test_keep_integer_part_of_native_fee(dst_eid: u32, amount: u128) {
    let (treasury, _) = setup_with_basis_points(1);
    let amount = amount.into();

    // The integer part should be kept.
    let fee = treasury.treasury.get_fee(USER, dst_eid, amount * BPS_DENOMINATOR, false).unwrap();
    assert_eq(fee, amount);
}

#[test]
#[fuzzer(runs: 10)]
fn test_drop_fractional_part_of_native_fee(dst_eid: u32, amount: u256) {
    let (treasury, _) = setup_with_basis_points(1);

    // The fractional part should be truncated.
    let fee = treasury.treasury.get_fee(USER, dst_eid, amount % BPS_DENOMINATOR, false).unwrap();
    assert_eq(fee, 0);
}

// =============================== LayerZero token =================================

#[test]
#[fuzzer(runs: 10)]
fn test_get_enabled_lz_token_fee(dst_eid: u32, worker_fee: u256, expected_fee: u256) {
    let (treasury, _) = setup();

    let library = deploy_mock_lz_token_fee_lib(0);
    let library_assertion = IMockLzTokenFeeLibAssertionDispatcher { contract_address: library };

    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_lz_token_fee_lib(Some(library)).unwrap();

    let fee = treasury.treasury.get_fee(USER, dst_eid, worker_fee, true).unwrap();
    assert_eq(fee, 0);

    let library = deploy_mock_lz_token_fee_lib(expected_fee);
    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_lz_token_fee_lib(Some(library)).unwrap();
    library_assertion.assert_payment_count(0);

    let fee = treasury.treasury.get_fee(USER, dst_eid, worker_fee, true).unwrap();
    assert_eq(fee, expected_fee);
    library_assertion.assert_payment_count(0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_disabled_lz_token_fee(dst_eid: u32, worker_fee: u256) {
    let (treasury, _) = setup();
    let result = treasury.treasury.get_fee(USER, dst_eid, worker_fee, true);
    assert_panic_with_error(result, err_lz_token_not_enabled());
}

#[test]
#[fuzzer(runs: 10)]
fn test_pay_enabled_lz_token_fee(dst_eid: u32, worker_fee: u256, expected_fee: u256) {
    let (treasury, _) = setup();
    let library = deploy_mock_lz_token_fee_lib(0);

    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_lz_token_fee_lib(Some(library)).unwrap();

    let fee = treasury.treasury.pay_fee(USER, dst_eid, worker_fee, true).unwrap();
    assert_eq(fee, 0);

    let library = deploy_mock_lz_token_fee_lib(expected_fee);
    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_lz_token_fee_lib(Some(library)).unwrap();

    let fee = treasury.treasury.pay_fee(USER, dst_eid, worker_fee, true).unwrap();
    assert_eq(fee, expected_fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_pay_enabled_lz_token_fee_multiple_times(
    dst_eid: u32, worker_fee: u256, expected_fee: u256,
) {
    let (treasury, _) = setup();
    let library = deploy_mock_lz_token_fee_lib(expected_fee);
    let library_assertion = IMockLzTokenFeeLibAssertionDispatcher { contract_address: library };

    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_lz_token_fee_lib(Some(library)).unwrap();
    library_assertion.assert_payment_count(0);

    let fee = treasury.treasury.pay_fee(USER, dst_eid, worker_fee, true).unwrap();
    assert_eq(fee, expected_fee);
    library_assertion.assert_payment_count(1);

    let fee = treasury.treasury.pay_fee(USER, dst_eid, worker_fee, true).unwrap();
    assert_eq(fee, expected_fee);
    library_assertion.assert_payment_count(2);
}

#[test]
#[fuzzer(runs: 10)]
fn test_pay_disabled_lz_token_fee(dst_eid: u32, worker_fee: u256) {
    let (treasury, _) = setup();
    let result = treasury.treasury.pay_fee(USER, dst_eid, worker_fee, true);
    assert_panic_with_error(result, err_lz_token_not_enabled());
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_lz_token_fee_as_owner(
    dst_eid: u32,
    worker_fee: u256,
    first_lz_token_fee_lib: ContractAddress,
    second_lz_token_fee_lib: ContractAddress,
) {
    let (treasury, _) = setup();
    assert_eq(treasury.treasury_admin.get_lz_token_fee_lib().unwrap(), None);

    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_lz_token_fee_lib(Some(first_lz_token_fee_lib)).unwrap();
    assert_eq(
        treasury.treasury_admin.get_lz_token_fee_lib().unwrap(), Some(first_lz_token_fee_lib),
    );

    cheat_caller_address_once(treasury.address, OWNER);
    treasury.treasury_admin.set_lz_token_fee_lib(Some(second_lz_token_fee_lib)).unwrap();
    assert_eq(
        treasury.treasury_admin.get_lz_token_fee_lib().unwrap(), Some(second_lz_token_fee_lib),
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_lz_token_fee_lib_as_non_owner(
    user: ContractAddress, lz_token_fee_lib: ContractAddress,
) {
    let (treasury, _) = setup();

    cheat_caller_address_once(treasury.address, user);
    let result = treasury.treasury_admin.set_lz_token_fee_lib(None);
    assert_panic_with_felt_error(result, 'Caller is not the owner');

    cheat_caller_address_once(treasury.address, user);
    let result = treasury.treasury_admin.set_lz_token_fee_lib(Some(lz_token_fee_lib));
    assert_panic_with_felt_error(result, 'Caller is not the owner');
}
