//! Executor Fee Lib tests

use core::num::traits::Pow;
use layerzero::workers::executor::errors;
use layerzero::workers::executor::fee_lib::interface::{
    FeeParams, IExecutorFeeLibDispatcher, IExecutorFeeLibDispatcherTrait,
    IExecutorFeeLibSafeDispatcher, IExecutorFeeLibSafeDispatcherTrait,
};
use layerzero::workers::executor::structs::DstConfig;
use layerzero::workers::price_feed::structs::GetFeeResponse;
use openzeppelin::access::ownable::OwnableComponent;
use openzeppelin::access::ownable::interface::IOwnableDispatcher;
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_mock_call, stop_mock_call};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::role_admin::{FuzzableRoleAdmin, RoleAdmin};
use crate::workers::base::utils::{ERC20Mock, deploy_mock_erc20};
use crate::workers::executor::utils::{
    ExecutorOptionBytes, serialize_executor_options, serialize_lz_receive_option,
};


/// Default multiplier basis points (120%)
const DEFAULT_MULTIPLIER_BPS: u16 = 12000;

/// Mock for Executor Fee Lib
#[derive(Drop)]
struct ExecutorFeeLibMock {
    pub fee_lib: ContractAddress,
    pub dispatcher: IExecutorFeeLibDispatcher,
    pub safe_dispatcher: IExecutorFeeLibSafeDispatcher,
    pub ownable: IOwnableDispatcher,
}

/// Deploy Executor Fee Lib for testing
fn deploy_executor_fee_lib(local_eid_v2: u32, owner: ContractAddress) -> ExecutorFeeLibMock {
    let contract = declare("ExecutorFeeLib").unwrap_syscall().contract_class();

    // Serialize constructor arguments
    let mut calldata = array![];
    local_eid_v2.serialize(ref calldata);
    owner.serialize(ref calldata);

    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    ExecutorFeeLibMock {
        fee_lib: contract_address,
        dispatcher: IExecutorFeeLibDispatcher { contract_address },
        safe_dispatcher: IExecutorFeeLibSafeDispatcher { contract_address },
        ownable: IOwnableDispatcher { contract_address },
    }
}

/// Create mock fee params for testing
fn create_mock_fee_params(
    price_feed: ContractAddress,
    dst_eid: u32,
    sender: ContractAddress,
    calldata_size: u32,
    default_multiplier_bps: u16,
) -> FeeParams {
    FeeParams { price_feed, dst_eid, sender, calldata_size, default_multiplier_bps }
}

/// Create basic executor options for testing (just lz_receive with no value)
fn create_basic_executor_options() -> ByteArray {
    let lz_receive_option = serialize_lz_receive_option(50000, Option::None); // 50k gas, no value
    serialize_executor_options(
        array![ExecutorOptionBytes { option_type: 1, option: lz_receive_option }],
    )
}

////////////////////////
// get_fee tests      //
////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn should_get_fee_with_valid_config(
    owner: RoleAdmin, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid,
) {
    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let ExecutorFeeLibMock { dispatcher, .. } = deploy_executor_fee_lib(dst_eid, owner);

    let dst_config = DstConfig {
        lz_receive_base_gas: 250000,
        multiplier_bps: DEFAULT_MULTIPLIER_BPS,
        floor_margin_usd: 0,
        native_cap: 10_u128.pow(18), // 1 ETH cap
        lz_compose_base_gas: 0,
    };
    let fee_params = create_mock_fee_params(
        price_feed, dst_eid, sender, 100, DEFAULT_MULTIPLIER_BPS,
    );

    // Mock price feed response
    let mock_response = GetFeeResponse {
        gas_fee: 1000000000000000000, // 1 ETH
        price_ratio: 1,
        price_ratio_denominator: 1,
        native_price_usd: 3000_u128 * 10_u128.pow(18) // $3000 per ETH
    };

    let options = create_basic_executor_options();
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);
    let fee = IExecutorFeeLibDispatcherTrait::get_fee(dispatcher, fee_params, dst_config, options);
    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Fee should be non-zero
    assert(fee > 0, 'Fee should be greater than 0');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_get_fee_when_eid_not_supported(
    owner: RoleAdmin, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid,
) {
    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let ExecutorFeeLibMock { safe_dispatcher, .. } = deploy_executor_fee_lib(dst_eid, owner);

    // Set dst_config with lz_receive_base_gas = 0 to simulate unsupported EID
    let dst_config = DstConfig {
        lz_receive_base_gas: 0, // This makes EID unsupported
        multiplier_bps: DEFAULT_MULTIPLIER_BPS,
        floor_margin_usd: 0,
        native_cap: 10_u128.pow(18),
        lz_compose_base_gas: 0,
    };
    let fee_params = create_mock_fee_params(
        price_feed, dst_eid, sender, 100, DEFAULT_MULTIPLIER_BPS,
    );

    // Should fail with EID_NOT_SUPPORTED
    let options = create_basic_executor_options();
    let res = IExecutorFeeLibSafeDispatcherTrait::get_fee(
        safe_dispatcher, fee_params, dst_config, options,
    );

    // Check that the error is as expected
    assert_panic_with_error(res, errors::err_eid_not_supported());
}

////////////////////////
// Version tests      //
////////////////////////

#[test]
#[fuzzer(runs: 1)]
fn should_return_correct_version(owner: ContractAddress) {
    let ExecutorFeeLibMock { dispatcher, .. } = deploy_executor_fee_lib(1, owner);

    let (major, minor) = IExecutorFeeLibDispatcherTrait::version(dispatcher);
    assert(major == 1, 'Major version should be 1');
    assert(minor == 1, 'Minor version should be 1');
}

////////////////////////
// get_fee_on_send    //
////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn get_fee_on_send_should_equal_get_fee(
    owner: RoleAdmin, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid,
) {
    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let ExecutorFeeLibMock { mut dispatcher, .. } = deploy_executor_fee_lib(dst_eid, owner);

    let dst_config = DstConfig {
        lz_receive_base_gas: 250000,
        multiplier_bps: DEFAULT_MULTIPLIER_BPS,
        floor_margin_usd: 0,
        native_cap: 10_u128.pow(18),
        lz_compose_base_gas: 0,
    };
    let fee_params = create_mock_fee_params(
        price_feed, dst_eid, sender, 100, DEFAULT_MULTIPLIER_BPS,
    );

    // Mock price feed response
    let mock_response = GetFeeResponse {
        gas_fee: 1000000000000000000, // 1 ETH
        price_ratio: 1,
        price_ratio_denominator: 1,
        native_price_usd: 3000_u128 * 10_u128.pow(18) // $3000 per ETH
    };

    let options = create_basic_executor_options();
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);

    let fee_view = IExecutorFeeLibDispatcherTrait::get_fee(
        dispatcher, fee_params.clone(), dst_config, options.clone(),
    );
    let fee_on_send = IExecutorFeeLibDispatcherTrait::get_fee_on_send(
        dispatcher, fee_params, dst_config, options,
    );

    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Both fees should be equal
    assert(fee_view == fee_on_send, 'fees should match');
}

//////////////////////////
// Withdraw token tests //
//////////////////////////

const TOKEN_SUPPLY: u256 = 1_000_000;
const TOKEN_OWNER: ContractAddress = 'token_owner'.try_into().unwrap();
const TOKEN_RECIPIENT: ContractAddress = 'token_recipient'.try_into().unwrap();

#[test]
#[fuzzer(runs: 10)]
fn withdraw_token_succeeds_when_owner(owner: ContractAddress, dst_eid: Eid) {
    let ERC20Mock { token, token_dispatcher } = deploy_mock_erc20(TOKEN_SUPPLY, TOKEN_OWNER);
    let ExecutorFeeLibMock {
        fee_lib, dispatcher, ..,
    } = deploy_executor_fee_lib(dst_eid.eid, owner);

    // Transfer tokens to the fee lib
    cheat_caller_address_once(token, TOKEN_OWNER);
    token_dispatcher.transfer(fee_lib, TOKEN_SUPPLY);

    // Caller is the owner
    cheat_caller_address_once(fee_lib, owner);
    dispatcher.withdraw_token(token, TOKEN_RECIPIENT, TOKEN_SUPPLY);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn withdraw_token_fails_when_not_owner(
    owner: ContractAddress, not_owner: ContractAddress, dst_eid: Eid,
) {
    let ERC20Mock { token, .. } = deploy_mock_erc20(TOKEN_SUPPLY, TOKEN_OWNER);
    let ExecutorFeeLibMock {
        fee_lib, safe_dispatcher, ..,
    } = deploy_executor_fee_lib(dst_eid.eid, owner);

    // Caller is not the owner
    cheat_caller_address_once(fee_lib, not_owner);
    let res = safe_dispatcher.withdraw_token(token, TOKEN_RECIPIENT, TOKEN_SUPPLY);
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn withdraw_token_fails_when_transfer_fails(owner: ContractAddress, dst_eid: Eid) {
    let ERC20Mock { token, .. } = deploy_mock_erc20(TOKEN_SUPPLY, TOKEN_OWNER);
    let ExecutorFeeLibMock {
        fee_lib, safe_dispatcher, ..,
    } = deploy_executor_fee_lib(dst_eid.eid, owner);

    // Transfer fails
    start_mock_call(token, selector!("transfer"), false);
    cheat_caller_address_once(fee_lib, owner);
    let res = safe_dispatcher.withdraw_token(token, TOKEN_RECIPIENT, TOKEN_SUPPLY);

    // Check that the withdraw token fails
    assert_panic_with_error(res, errors::err_transfer_failed());
}
