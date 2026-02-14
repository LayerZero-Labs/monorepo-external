//! DVN Fee Lib tests

use core::num::traits::Pow;
use layerzero::common::constants::BPS_DENOMINATOR;
use layerzero::workers::dvn::errors;
use layerzero::workers::dvn::fee_lib::interface::{
    FeeParams, IDvnFeeLibDispatcher, IDvnFeeLibDispatcherTrait, IDvnFeeLibSafeDispatcher,
    IDvnFeeLibSafeDispatcherTrait,
};
use layerzero::workers::dvn::structs::DstConfig;
use layerzero::workers::price_feed::structs::GetFeeResponse;
use openzeppelin::access::ownable::OwnableComponent;
use openzeppelin::access::ownable::interface::IOwnableDispatcher;
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::fuzzable::{FuzzableU16, FuzzableU32, FuzzableU64};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_mock_call, stop_mock_call};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::fuzzable::contract_address::{FuzzableContractAddress, FuzzableContractAddresses};
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::role_admin::{FuzzableRoleAdmin, RoleAdmin};
use crate::workers::base::utils::{ERC20Mock, deploy_mock_erc20};

/// Default multiplier basis points (120%)
const DEFAULT_MULTIPLIER_BPS: u16 = 12000;

/// Mock for DVN Fee Lib
#[derive(Drop)]
struct DvnFeeLibMock {
    pub fee_lib: ContractAddress,
    pub dispatcher: IDvnFeeLibDispatcher,
    pub safe_dispatcher: IDvnFeeLibSafeDispatcher,
    pub ownable: IOwnableDispatcher,
}

/// Deploy DVN Fee Lib for testing
fn deploy_dvn_fee_lib(local_eid_v2: u32, owner: ContractAddress) -> DvnFeeLibMock {
    let contract = declare("DvnFeeLib").unwrap_syscall().contract_class();
    let mut constructor_calldata = array![];

    local_eid_v2.serialize(ref constructor_calldata);
    owner.serialize(ref constructor_calldata);

    let (fee_lib, _) = contract.deploy(@constructor_calldata).unwrap_syscall();

    DvnFeeLibMock {
        fee_lib,
        dispatcher: IDvnFeeLibDispatcher { contract_address: fee_lib },
        safe_dispatcher: IDvnFeeLibSafeDispatcher { contract_address: fee_lib },
        ownable: IOwnableDispatcher { contract_address: fee_lib },
    }
}

/// Create mock fee params for testing
fn create_mock_fee_params(
    price_feed: ContractAddress,
    dst_eid: u32,
    sender: ContractAddress,
    quorum: u32,
    default_multiplier_bps: u16,
) -> FeeParams {
    FeeParams { price_feed, dst_eid, confirmations: 0, sender, quorum, default_multiplier_bps }
}

/////////////////
// Quote tests //
/////////////////

#[test]
#[fuzzer(runs: 10)]
fn should_quote_with_floor_margin(
    owner: RoleAdmin, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid,
) {
    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let DvnFeeLibMock { dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    // Let's assume ETH is the native token (18 decimals).
    // Let's set a 20% premium (multiplier_bps = 12000).
    // Let's set a floor margin of $2.00 USD.
    let dst_config = DstConfig {
        gas: 250000,
        multiplier_bps: DEFAULT_MULTIPLIER_BPS, // 120% => 20% premium
        floor_margin_usd: 2_000_000_000_000_000_000 // $2.00 with 18 decimals
    };

    let fee_params = create_mock_fee_params(
        price_feed, dst_eid, sender, 2, // quorum
        DEFAULT_MULTIPLIER_BPS,
    );

    // The price_feed determines the base gas cost to be 0.001 ETH.
    let mock_gas_fee = 1_000_000_000_000_000; // 0.001 ETH in wei
    // 1 ETH = $4000. We send price with 18 decimals.
    let native_price_usd = 4000_u128 * 10_u128.pow(18);
    let mock_response = GetFeeResponse {
        gas_fee: mock_gas_fee,
        price_ratio: 1, // Source and dest chains use same-priced native token
        price_ratio_denominator: 1,
        native_price_usd,
    };

    // Mock the price feed response
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);
    let quote = IDvnFeeLibDispatcherTrait::get_fee(dispatcher, fee_params, dst_config, "");
    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Expected fee calculation:
    // 1. Fee with multiplier
    // multiplier = 12000 / 10000 = 1.2
    // fee_with_multiplier = 0.001 ETH * 1.2 = 0.0012 ETH
    // fee_with_multiplier = 1_200_000_000_000_000

    // 2. Fee with floor margin
    // Correct logic is: `fee + (margin_usd / native_price_usd) * 1e18`
    // margin_in_native = ($2.00 / $4000) * 1e18 = 0.0005 ETH
    // fee_with_floor_margin = 0.001 ETH + 0.0005 ETH = 0.0015 ETH
    // fee_with_floor_margin = 1_500_000_000_000_000

    // The expected fee is the max of the two calculations.
    // fee_with_multiplier =   1_200_000_000_000_000
    // fee_with_floor_margin = 1_500_000_000_000_000
    let expected_fee = 1_500_000_000_000_000_u256;

    // Check that the quote is correct
    assert(quote == expected_fee, 'Quote should be as expected');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_to_quote_when_eid_not_supported(
    owner: ContractAddress, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid,
) {
    let dst_eid = dst_eid.eid;
    let DvnFeeLibMock { safe_dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    let fee_params = create_mock_fee_params(price_feed, dst_eid, sender, 2, DEFAULT_MULTIPLIER_BPS);

    // Default destination config has 0 gas
    let dst_config = DstConfig { gas: 0, multiplier_bps: 0, floor_margin_usd: 0 };
    let res = IDvnFeeLibSafeDispatcherTrait::get_fee(safe_dispatcher, fee_params, dst_config, "");

    // Check that the error is as expected
    assert_panic_with_error(res, errors::err_eid_not_supported(dst_eid));
}

#[test]
#[fuzzer(runs: 10)]
fn should_quote_with_default_bps(
    owner: RoleAdmin, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid, gas: u64,
) {
    // Zero gas throws the error: DVN_EID_NOT_SUPPORTED
    // Tested in should_fail_to_quote_when_eid_not_supported
    if gas == 0 {
        return;
    }

    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let DvnFeeLibMock { dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    let dst_config = DstConfig { gas, multiplier_bps: 0, floor_margin_usd: 0 };
    let fee_params = create_mock_fee_params(price_feed, dst_eid, sender, 2, DEFAULT_MULTIPLIER_BPS);

    let mock_gas_fee = 1_000_000_000_000_000;
    let mock_response = GetFeeResponse {
        gas_fee: mock_gas_fee,
        price_ratio: 1,
        price_ratio_denominator: 1,
        native_price_usd: 4000_u128 * 10_u128.pow(18),
    };

    // Mock the price feed response
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);
    let quote = IDvnFeeLibDispatcherTrait::get_fee(dispatcher, fee_params, dst_config, "");
    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Since multiplier_bps is 0, it should use default_multiplier_bps
    let expected_fee = (mock_gas_fee.into() * DEFAULT_MULTIPLIER_BPS.into()) / BPS_DENOMINATOR;
    assert(quote == expected_fee, 'Quote should use default bps');
}

#[test]
#[fuzzer(runs: 10)]
fn should_quote_with_zero_margin_usd(
    owner: RoleAdmin,
    price_feed: ContractAddress,
    sender: ContractAddress,
    dst_eid: Eid,
    gas: u64,
    multiplier_bps: u16,
) {
    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let DvnFeeLibMock { dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    let dst_config = DstConfig { gas, multiplier_bps, floor_margin_usd: 0 };
    let fee_params = create_mock_fee_params(price_feed, dst_eid, sender, 2, DEFAULT_MULTIPLIER_BPS);

    let mock_gas_fee = 1_000_000_000_000_000;
    let native_price_usd = 4000_u128 * 10_u128.pow(18);
    let mock_response = GetFeeResponse {
        gas_fee: mock_gas_fee, price_ratio: 1, price_ratio_denominator: 1, native_price_usd,
    };

    // Mock the price feed response
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);
    let quote = IDvnFeeLibDispatcherTrait::get_fee(dispatcher, fee_params, dst_config, "");
    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Check that the quote is the fee with multiplier
    let fee_with_multiplier = (mock_gas_fee.into() * multiplier_bps.into()) / BPS_DENOMINATOR;
    assert(quote == fee_with_multiplier, 'Quote should be as expected');
}

#[test]
#[fuzzer(runs: 10)]
fn should_quote_with_zero_native_price(
    owner: RoleAdmin,
    price_feed: ContractAddress,
    sender: ContractAddress,
    dst_eid: Eid,
    gas: u64,
    multiplier_bps: u16,
) {
    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let DvnFeeLibMock { dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    let dst_config = DstConfig { gas, multiplier_bps, floor_margin_usd: 2_000_000_000_000_000_000 };
    let fee_params = create_mock_fee_params(price_feed, dst_eid, sender, 2, DEFAULT_MULTIPLIER_BPS);

    let mock_gas_fee = 1_000_000_000_000_000;
    let mock_response = GetFeeResponse {
        gas_fee: mock_gas_fee, price_ratio: 1, price_ratio_denominator: 1, native_price_usd: 0,
    };

    // Mock the price feed response
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);
    let quote = IDvnFeeLibDispatcherTrait::get_fee(dispatcher, fee_params, dst_config, "");
    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Check that the quote is the fee with multiplier
    let fee_with_multiplier = (mock_gas_fee.into() * multiplier_bps.into()) / BPS_DENOMINATOR;
    assert(quote == fee_with_multiplier, 'Quote should be as expected');
}

#[test]
#[fuzzer(runs: 10)]
fn should_quote_with_multiplier_higher_than_floor(
    owner: RoleAdmin, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid, gas: u64,
) {
    let dst_eid = dst_eid.eid;
    let multiplier_bps = 15000;
    let owner = owner.address;
    let DvnFeeLibMock { dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    let dst_config = DstConfig { gas, multiplier_bps, floor_margin_usd: 1_000_000_000_000_000 };
    let fee_params = create_mock_fee_params(price_feed, dst_eid, sender, 2, DEFAULT_MULTIPLIER_BPS);

    let mock_gas_fee = 1_000_000_000_000_000;
    let native_price_usd = 4000_u128 * 10_u128.pow(18);
    let mock_response = GetFeeResponse {
        gas_fee: mock_gas_fee, price_ratio: 1, price_ratio_denominator: 1, native_price_usd,
    };

    // Mock the price feed response
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);
    let quote = IDvnFeeLibDispatcherTrait::get_fee(dispatcher, fee_params, dst_config, "");
    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // fee_with_multiplier = 0.001 * 1.5 = 0.0015 ETH
    let fee_with_multiplier = (mock_gas_fee.into() * multiplier_bps.into()) / BPS_DENOMINATOR;

    // fee_with_floor_margin = fee + (margin_usd * 1e18) / native_price_usd
    // margin_in_native = ($0.001 / $4000) * 1e18 = 0.00000025 ETH
    // fee_with_floor_margin = 0.001 + 0.00000025 = 0.00100025 ETH
    let fee_with_floor_margin = 1_000_250_000_000_000_u256;

    // Check that the fee with multiplier is higher than the fee with floor margin
    assert(fee_with_multiplier > fee_with_floor_margin, 'Multiplier should be higher');

    // Check that the quote is the fee with multiplier
    assert(quote == fee_with_multiplier, 'Quote should be as expected');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_quote_with_invalid_options(
    owner: RoleAdmin, price_feed: ContractAddress, sender: ContractAddress, dst_eid: Eid,
) {
    let dst_eid = dst_eid.eid;
    let owner = owner.address;
    let DvnFeeLibMock { safe_dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    let dst_config = DstConfig {
        gas: 250000, multiplier_bps: DEFAULT_MULTIPLIER_BPS, floor_margin_usd: 0,
    };
    let fee_params = create_mock_fee_params(price_feed, dst_eid, sender, 2, DEFAULT_MULTIPLIER_BPS);

    // Pass non-empty options (should fail)
    let res = IDvnFeeLibSafeDispatcherTrait::get_fee(
        safe_dispatcher, fee_params, dst_config, "invalid_options",
    );

    // Check that the error is as expected
    assert_panic_with_error(res, errors::err_invalid_dvn_options(0));
}

////////////////////////
// Version tests      //
////////////////////////

#[test]
#[fuzzer(runs: 1)]
fn should_return_correct_version(owner: ContractAddress) {
    let DvnFeeLibMock { dispatcher, .. } = deploy_dvn_fee_lib(1, owner);

    let (major, minor) = IDvnFeeLibDispatcherTrait::version(dispatcher);
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
    let DvnFeeLibMock { dispatcher, .. } = deploy_dvn_fee_lib(dst_eid, owner);

    let dst_config = DstConfig {
        gas: 250000, multiplier_bps: DEFAULT_MULTIPLIER_BPS, floor_margin_usd: 0,
    };
    let fee_params = create_mock_fee_params(price_feed, dst_eid, sender, 2, DEFAULT_MULTIPLIER_BPS);

    let mock_gas_fee = 1_000_000_000_000_000;
    let mock_response = GetFeeResponse {
        gas_fee: mock_gas_fee,
        price_ratio: 1,
        price_ratio_denominator: 1,
        native_price_usd: 4000_u128 * 10_u128.pow(18),
    };

    // Mock the price feed response
    start_mock_call(price_feed, selector!("estimate_fee_by_eid"), mock_response);

    let fee_on_send = IDvnFeeLibDispatcherTrait::get_fee_on_send(
        dispatcher, fee_params.clone(), dst_config, "",
    );
    let fee = IDvnFeeLibDispatcherTrait::get_fee(dispatcher, fee_params, dst_config, "");

    stop_mock_call(price_feed, selector!("estimate_fee_by_eid"));

    // Both functions should return the same result
    assert(fee_on_send == fee, 'fee_on_send should equal fee');
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
    let DvnFeeLibMock { fee_lib, dispatcher, .. } = deploy_dvn_fee_lib(dst_eid.eid, owner);

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
    let DvnFeeLibMock { fee_lib, safe_dispatcher, .. } = deploy_dvn_fee_lib(dst_eid.eid, owner);

    // Caller is not the owner
    cheat_caller_address_once(fee_lib, not_owner);
    let res = safe_dispatcher.withdraw_token(token, TOKEN_RECIPIENT, TOKEN_SUPPLY);
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn withdraw_token_fails_with_transfer_failed(owner: ContractAddress, dst_eid: Eid) {
    let ERC20Mock { token, .. } = deploy_mock_erc20(TOKEN_SUPPLY, TOKEN_OWNER);
    let DvnFeeLibMock { fee_lib, safe_dispatcher, .. } = deploy_dvn_fee_lib(dst_eid.eid, owner);

    // Transfer fails with `false`
    start_mock_call(token, selector!("transfer"), false);
    cheat_caller_address_once(fee_lib, owner);
    let res = safe_dispatcher.withdraw_token(token, TOKEN_RECIPIENT, TOKEN_SUPPLY);
    assert_panic_with_error(res, errors::err_transfer_failed());
}
