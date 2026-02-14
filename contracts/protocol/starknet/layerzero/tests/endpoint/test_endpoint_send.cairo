//! Test endpoint send

use core::num::traits::Zero;
use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::common::structs::messaging::MessagingParams;
use layerzero::endpoint::endpoint_v2::EndpointV2;
use layerzero::endpoint::errors;
use layerzero::endpoint::events::{DelegateSet, PacketSent};
use layerzero::endpoint::interfaces::endpoint_v2::{
    IEndpointV2SafeDispatcher, IEndpointV2SafeDispatcherTrait,
};
use layerzero::endpoint::message_lib_manager::interface::{
    IMessageLibManagerDispatcher, IMessageLibManagerDispatcherTrait,
};
use layerzero::message_lib::sml::simple_message_lib::SimpleMessageLib::{
    ISimpleMessageLibHelpersDispatcher, ISimpleMessageLibHelpersDispatcherTrait,
};
use layerzero::message_lib::structs::MessageLibType;
use lz_utils::bytes::ContractAddressIntoBytes32;
use openzeppelin::access::ownable::interface::{IOwnableDispatcher, IOwnableDispatcherTrait};
use openzeppelin::token::erc20::ERC20Component::Errors::TRANSFER_TO_ZERO;
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::common::utils::{total_lz_fee_from_receipt, total_native_fee_from_receipt};
use crate::e2e::utils::deploy_blocked_message_lib;

// Test constants
const OWNER: ContractAddress = 'owner'.try_into().unwrap();
const SENDER: ContractAddress = 'sender'.try_into().unwrap();
const RECEIVER: ContractAddress = 'receiver'.try_into().unwrap();
const RECEIVER_2: ContractAddress = 'receiver2'.try_into().unwrap();
const REFUND_ADDRESS: ContractAddress = 'refund'.try_into().unwrap();
const LIBRARY_ADDRESS: ContractAddress = 'library'.try_into().unwrap();
const NON_OWNER: ContractAddress = 'non_owner'.try_into().unwrap();
const LZ_TOKEN: ContractAddress = 'lz_token'.try_into().unwrap();
const DELEGATE: ContractAddress = 'delegate'.try_into().unwrap();
const BLOCKED_LIBRARY: ContractAddress = 'blocked_library'.try_into().unwrap();
const EID: u32 = 1;
const DST_EID: u32 = 2;

// Token amounts
const INITIAL_SUPPLY: u256 = 1000000_u256; // 1M tokens
const SENDER_INITIAL_BALANCE: u256 = 10000_u256; // 10K tokens
const REFUND_INITIAL_BALANCE: u256 = 1000_u256; // 1K tokens
const LZ_TOKEN_FEE: u256 = 2000; // 2K tokens

// test assert message constants
const OWNER_NOT_SET: felt252 = 'Owner not set correctly';
const REGISTER_LIBRARY_FAILED: felt252 = 'registerLibrary failed';
const SET_SEND_LIBRARY_FAILED: felt252 = 'setSendLibrary failed';
const SEND_SHOULD_SUCCEED: felt252 = 'Send should succeed';
const SEND_SHOULD_FAIL: felt252 = 'Send should fail';
const NONCE_SHOULD_INCREMENT: felt252 = 'Nonce should increment';
const LZ_RECEIVE_SHOULD_NOT_PANIC: felt252 = 'lzReceive should not panic';

fn deploy_mock_erc20() -> (IERC20Dispatcher, ContractAddress) {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        INITIAL_SUPPLY.low.into(), INITIAL_SUPPLY.high.into(), OWNER.into(),
    ];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    (IERC20Dispatcher { contract_address }, contract_address)
}

fn deploy_endpoint_with_token(
    token_address: ContractAddress,
) -> (IEndpointV2SafeDispatcher, ContractAddress) {
    let blocked_library = deploy_blocked_message_lib();
    let contract = declare("EndpointV2").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        OWNER.into(), EID.into(), token_address.into(), blocked_library.into(),
    ];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    (IEndpointV2SafeDispatcher { contract_address }, contract_address)
}

fn deploy_simple_message_lib(endpoint: ContractAddress) -> ContractAddress {
    let contract = declare("SimpleMessageLib").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![endpoint.into()]).unwrap_syscall();
    address
}

fn setup_tokens_and_balances(token: IERC20Dispatcher, endpoint_address: ContractAddress) {
    // Give tokens to SENDER and REFUND_ADDRESS
    start_cheat_caller_address(token.contract_address, OWNER);
    token.transfer(SENDER, SENDER_INITIAL_BALANCE);
    token.transfer(REFUND_ADDRESS, REFUND_INITIAL_BALANCE);
    stop_cheat_caller_address(token.contract_address);

    // SENDER approves endpoint to spend tokens (large amount for multiple sends)
    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, SENDER_INITIAL_BALANCE);
}

fn setup_lz_token_balances(lz_token: IERC20Dispatcher, endpoint_address: ContractAddress) {
    // Give tokens to SENDER
    cheat_caller_address_once(lz_token.contract_address, OWNER);
    lz_token.transfer(SENDER, SENDER_INITIAL_BALANCE);

    // SENDER approves endpoint to spend tokens (large amount for multiple sends)
    cheat_caller_address_once(lz_token.contract_address, SENDER);
    lz_token.approve(endpoint_address, SENDER_INITIAL_BALANCE);
}

fn reapprove_tokens(token: IERC20Dispatcher, endpoint_address: ContractAddress, amount: u256) {
    cheat_caller_address_once(token.contract_address, OWNER);
    token.transfer(SENDER, amount);

    // Helper function to re-approve tokens for subsequent sends
    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, amount);
}

#[derive(Drop)]
struct SetupResult {
    endpoint: IEndpointV2SafeDispatcher,
    endpoint_address: ContractAddress,
    lib_address: ContractAddress,
    token: IERC20Dispatcher,
    lib_helpers: ISimpleMessageLibHelpersDispatcher,
    message_lib_manager: IMessageLibManagerDispatcher,
}

fn setup_with_registered_library() -> SetupResult {
    let (token, token_address) = deploy_mock_erc20();
    let (endpoint, endpoint_address) = deploy_endpoint_with_token(token_address);
    let lib_address = deploy_simple_message_lib(endpoint_address);

    let lib_helpers = ISimpleMessageLibHelpersDispatcher { contract_address: lib_address };
    lib_helpers.set_use_mock_payees();

    // Setup token balances and approvals
    setup_tokens_and_balances(token, endpoint_address);

    // Register the library as owner
    cheat_caller_address_once(endpoint_address, OWNER);
    let message_lib_manager = IMessageLibManagerDispatcher { contract_address: endpoint_address };
    // Satisfy registration-time type check
    start_mock_call(lib_address, selector!("message_lib_type"), MessageLibType::SendAndReceive);
    message_lib_manager.register_library(lib_address);

    SetupResult { endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager }
}

fn setup_with_send_library() -> SetupResult {
    let (token, token_address) = deploy_mock_erc20();
    let (endpoint, endpoint_address) = deploy_endpoint_with_token(token_address);
    let lib_address = deploy_simple_message_lib(endpoint_address);

    let lib_helpers = ISimpleMessageLibHelpersDispatcher { contract_address: lib_address };
    lib_helpers.set_use_mock_payees();

    // Setup token balances and approvals
    setup_tokens_and_balances(token, endpoint_address);

    // Register the library as owner
    cheat_caller_address_once(endpoint_address, OWNER);
    let message_lib_manager = IMessageLibManagerDispatcher { contract_address: endpoint_address };
    message_lib_manager.register_library(lib_address);

    // Set send library for the sender
    cheat_caller_address_once(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    SetupResult { endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager }
}

#[derive(Drop)]
struct SetupResultWithLzToken {
    endpoint: IEndpointV2SafeDispatcher,
    endpoint_address: ContractAddress,
    lib_address: ContractAddress,
    token: IERC20Dispatcher,
    lib_helpers: ISimpleMessageLibHelpersDispatcher,
    message_lib_manager: IMessageLibManagerDispatcher,
    lz_token_address: ContractAddress,
    lz_token: IERC20Dispatcher,
}

#[derive(Drop)]
enum PayeeType {
    LzPayees,
    MixedPayees,
}

fn setup_with_send_library_and_lz_token(payee_type: PayeeType) -> SetupResultWithLzToken {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager,
    } = setup_with_send_library();

    // Deploy lz token ERC20
    let (lz_token, lz_token_address) = deploy_mock_erc20();

    // Set endpoint lz token address
    cheat_caller_address_once(endpoint_address, OWNER);
    endpoint.set_lz_token(lz_token_address).unwrap_syscall();

    // Use mock LZ payees
    match payee_type {
        PayeeType::LzPayees => lib_helpers.set_use_mock_lz_payees(),
        PayeeType::MixedPayees => lib_helpers.set_use_mock_mixed_payees(),
    }

    setup_lz_token_balances(lz_token, endpoint_address);

    SetupResultWithLzToken {
        endpoint,
        endpoint_address,
        lib_address,
        token,
        lib_helpers,
        message_lib_manager,
        lz_token_address,
        lz_token,
    }
}

#[test]
fn test_constructor() {
    let (_, token_address) = deploy_mock_erc20();
    let (_endpoint, endpoint_address) = deploy_endpoint_with_token(token_address);

    // Test ownership
    let ownable = IOwnableDispatcher { contract_address: endpoint_address };
    assert(ownable.owner() == OWNER, OWNER_NOT_SET);
}

#[test]
fn test_send_success() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Check initial balances and allowance
    let sender_balance_before = token.balance_of(SENDER);
    let refund_balance_before = token.balance_of(REFUND_ADDRESS);
    let endpoint_balance_before = token.balance_of(endpoint_address);
    let allowance_before = token.allowance(SENDER, endpoint_address);

    let mut spy = spy_events();
    let result = endpoint.send(params, REFUND_ADDRESS);

    // Check that PacketSent event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketSent(
                        PacketSent {
                            encoded_packet: "mock_encoded_packet_data",
                            options: "test options",
                            send_library: lib_address,
                        },
                    ),
                ),
            ],
        );

    stop_cheat_caller_address(endpoint_address);

    assert(result.is_ok(), SEND_SHOULD_SUCCEED);
    let receipt = result.unwrap();
    assert(receipt.nonce == 1, NONCE_SHOULD_INCREMENT);
    let total_fee = total_native_fee_from_receipt(@receipt);
    assert(total_fee == lib_helpers.get_native_fee(), 'Fee should match mock');

    // Check balances after send
    let sender_balance_after = token.balance_of(SENDER);
    let refund_balance_after = token.balance_of(REFUND_ADDRESS);
    let endpoint_balance_after = token.balance_of(endpoint_address);
    let allowance_after = token.allowance(SENDER, endpoint_address);

    // Sender should have spent the fee amount
    assert(
        sender_balance_after == sender_balance_before - allowance_before,
        'Sender balance should decrease',
    );

    // Refund address should have received the remainder
    assert(
        refund_balance_after == (refund_balance_before + (allowance_before - total_fee)),
        'Refund should receive remainder',
    );

    // EndpointV2 should not hold any tokens after the transaction
    assert(endpoint_balance_after == endpoint_balance_before, 'Endpoint should not hold tokens');

    // The allowance should be entirely consumed
    assert(allowance_after == 0, 'Allowance should be consumed');
    assert(allowance_before > 0, 'Should have had allowance');
    assert(
        allowance_before >= sender_balance_before - sender_balance_after, 'Allowance sufficient',
    );
}

////////////////////////////
// LZ token payment tests //
////////////////////////////

#[test]
fn send_lz_token_pay_succeeds() {
    let SetupResultWithLzToken {
        endpoint, endpoint_address, lib_address, lib_helpers, lz_token, ..,
    } = setup_with_send_library_and_lz_token(PayeeType::LzPayees);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: true,
    };

    // Check initial LZ token balances and allowance
    let sender_balance_before = lz_token.balance_of(SENDER);
    let refund_balance_before = lz_token.balance_of(REFUND_ADDRESS);
    let endpoint_balance_before = lz_token.balance_of(endpoint_address);
    let allowance_before = lz_token.allowance(SENDER, endpoint_address);

    let mut spy = spy_events();

    cheat_caller_address_once(endpoint_address, SENDER);
    let result = endpoint.send(params, REFUND_ADDRESS);

    // Check that PacketSent event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketSent(
                        PacketSent {
                            encoded_packet: "mock_encoded_packet_data",
                            options: "test options",
                            send_library: lib_address,
                        },
                    ),
                ),
            ],
        );

    let receipt = result.unwrap();
    assert(receipt.nonce == 1, NONCE_SHOULD_INCREMENT);

    let total_fee = total_lz_fee_from_receipt(@receipt);
    assert(total_fee == lib_helpers.get_lz_token_fee(), 'Fee should match mock');

    // Check LZ token balances after send
    let sender_balance_after = lz_token.balance_of(SENDER);
    let refund_balance_after = lz_token.balance_of(REFUND_ADDRESS);
    let endpoint_balance_after = lz_token.balance_of(endpoint_address);
    let allowance_after = lz_token.allowance(SENDER, endpoint_address);

    // Sender should have spent the LZ token fee amount
    assert(
        sender_balance_after == sender_balance_before - allowance_before,
        'Sender balance should decrease',
    );

    // Refund address should have received the remainder of the LZ token allowance
    assert(
        refund_balance_after == refund_balance_before + allowance_before - total_fee,
        'Refund should receive remainder',
    );

    // EndpointV2 should not hold any LZ tokens after the transaction
    assert(endpoint_balance_after == endpoint_balance_before, 'Endpoint should not hold tokens');

    // The LZ token allowance should be entirely consumed
    assert(allowance_after == 0, 'Allowance should be consumed');
    assert(allowance_before > 0, 'Should have had allowance');
    assert(
        allowance_before >= sender_balance_before - sender_balance_after, 'Allowance sufficient',
    );
}

#[test]
fn send_lz_token_mixed_payment_succeeds() {
    let SetupResultWithLzToken {
        endpoint, endpoint_address, token: native_token, lib_address, lib_helpers, lz_token, ..,
    } = setup_with_send_library_and_lz_token(PayeeType::MixedPayees);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: true,
    };

    // Check initial token balances and allowances
    let sender_lz_before = lz_token.balance_of(SENDER);
    let refund_lz_before = lz_token.balance_of(REFUND_ADDRESS);
    let endpoint_lz_before = lz_token.balance_of(endpoint_address);
    let allowance_lz_before = lz_token.allowance(SENDER, endpoint_address);

    let sender_native_before = native_token.balance_of(SENDER);
    let refund_native_before = native_token.balance_of(REFUND_ADDRESS);
    let endpoint_native_before = native_token.balance_of(endpoint_address);
    let allowance_native_before = native_token.allowance(SENDER, endpoint_address);

    let mut spy = spy_events();

    // SENDER sends a message with mixed payment
    cheat_caller_address_once(endpoint_address, SENDER);
    let result = endpoint.send(params, REFUND_ADDRESS);

    // Check that PacketSent event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketSent(
                        PacketSent {
                            encoded_packet: "mock_encoded_packet_data",
                            options: "test options",
                            send_library: lib_address,
                        },
                    ),
                ),
            ],
        );

    let receipt = result.unwrap();
    assert(receipt.nonce == 1, NONCE_SHOULD_INCREMENT);

    ///////////////////////
    // Native token fees //
    ///////////////////////

    let total_native_fee = total_native_fee_from_receipt(@receipt);
    assert(total_native_fee == lib_helpers.get_native_fee(), 'Fee should match mock');

    // Check native token balances after send
    let sender_native_after = native_token.balance_of(SENDER);
    let refund_native_after = native_token.balance_of(REFUND_ADDRESS);
    let endpoint_native_after = native_token.balance_of(endpoint_address);
    let allowance_native_after = native_token.allowance(SENDER, endpoint_address);

    // Sender should have spent the native fee amount
    assert(
        sender_native_after == sender_native_before - allowance_native_before,
        'Sender balance should decrease',
    );

    // Refund address should have received the remainder of the native allowance
    assert(
        refund_native_after == refund_native_before + allowance_native_before - total_native_fee,
        'Refund should receive remainder',
    );

    // EndpointV2 should not hold any native tokens after the transaction
    assert(endpoint_native_after == endpoint_native_before, 'Endpoint should not hold tokens');

    // The native allowance should be entirely consumed
    assert(allowance_native_after == 0, 'Allowance should be consumed');
    assert(allowance_native_before > 0, 'Should have had allowance');
    assert(
        allowance_native_before >= sender_native_before - sender_native_after,
        'Allowance sufficient',
    );

    ///////////////////
    // LZ token fees //
    ///////////////////

    let total_lz_fee = total_lz_fee_from_receipt(@receipt);
    assert(total_lz_fee == lib_helpers.get_lz_token_fee(), 'Fee should match mock');

    // Check LZ token balances after send
    let sender_lz_after = lz_token.balance_of(SENDER);
    let refund_lz_after = lz_token.balance_of(REFUND_ADDRESS);
    let endpoint_lz_after = lz_token.balance_of(endpoint_address);
    let allowance_lz_after = lz_token.allowance(SENDER, endpoint_address);

    // Sender should have spent the LZ token fee amount
    assert(
        sender_lz_after == sender_lz_before - allowance_lz_before, 'Sender balance should decrease',
    );

    // Refund address should have received the remainder of the LZ token allowance
    assert(
        refund_lz_after == refund_lz_before + allowance_lz_before - total_lz_fee,
        'Refund should receive remainder',
    );

    // EndpointV2 should not hold any LZ tokens after the transaction
    assert(endpoint_lz_after == endpoint_lz_before, 'Endpoint should not hold tokens');

    // The LZ token allowance should be entirely consumed
    assert(allowance_lz_after == 0, 'Allowance should be consumed');
    assert(allowance_lz_before > 0, 'Should have had allowance');
    assert(allowance_lz_before >= sender_lz_before - sender_lz_after, 'Allowance sufficient');
}

#[test]
fn send_lz_token_fails_when_lz_token_unavailable() {
    let SetupResult { endpoint, endpoint_address, .. } = setup_with_send_library();

    let params = MessagingParams { pay_in_lz_token: true, ..Default::default() };

    // Attempt to send with LZ token payment but no LZ token set
    cheat_caller_address_once(endpoint_address, SENDER);
    let res = endpoint.send(params, REFUND_ADDRESS);

    // Check that we error with LZ token unavailable
    assert_panic_with_error(res, errors::err_lz_token_unavailable());
}

/////////////////
// Nonce tests //
/////////////////

#[test]
fn test_send_nonce_increments() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Send multiple messages and verify nonce increments
    let mut i: u64 = 1;
    while i != 5 {
        // Re-approve tokens for each send (endpoint takes entire allowance)
        if i > 1 {
            reapprove_tokens(token, endpoint_address, 2000_u256); // Enough for one send
        }

        let result = endpoint.send(params.clone(), REFUND_ADDRESS);
        assert(result.is_ok(), SEND_SHOULD_SUCCEED);
        let receipt = result.unwrap();
        assert(receipt.nonce == i, NONCE_SHOULD_INCREMENT);
        i += 1;
    }
}

#[test]
fn test_send_different_senders_independent_nonces() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, ..,
    } = setup_with_registered_library();

    // Give tokens to NON_OWNER and approve endpoint
    cheat_caller_address_once(token.contract_address, OWNER);
    token.transfer(NON_OWNER, SENDER_INITIAL_BALANCE);

    cheat_caller_address_once(token.contract_address, NON_OWNER);
    token.approve(endpoint_address, SENDER_INITIAL_BALANCE);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Set send library for both senders
    cheat_caller_address_once(endpoint_address, SENDER);
    let message_lib_manager_dispatcher = IMessageLibManagerDispatcher {
        contract_address: endpoint_address,
    };
    message_lib_manager_dispatcher.set_send_library(SENDER, DST_EID, lib_address);

    cheat_caller_address_once(endpoint_address, NON_OWNER);
    message_lib_manager_dispatcher.set_send_library(NON_OWNER, DST_EID, lib_address);

    // Send from first sender
    cheat_caller_address_once(endpoint_address, SENDER);
    let result1 = endpoint.send(params.clone(), REFUND_ADDRESS).unwrap();
    assert(result1.nonce == 1, 'First sender nonce should be 1');

    reapprove_tokens(token, endpoint_address, 2000_u256);

    // Send from second sender
    cheat_caller_address_once(endpoint_address, NON_OWNER);
    let result2 = endpoint.send(params.clone(), REFUND_ADDRESS).unwrap();
    assert(result2.nonce == 1, 'Second sender nonce should be 1');

    // Re-approve tokens for second send from first sender
    reapprove_tokens(token, endpoint_address, 2000_u256);

    // Send again from first sender
    cheat_caller_address_once(endpoint_address, SENDER);
    let result3 = endpoint.send(params.clone(), REFUND_ADDRESS).unwrap();
    assert(result3.nonce == 2, 'First sender nonce should be 2');
}

#[test]
fn test_send_different_destinations_independent_nonces() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    let dst_eid_1 = 101_u32;
    let dst_eid_2 = 102_u32;

    // Set send library for both destinations
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, dst_eid_1, lib_address);
    message_lib_manager.set_send_library(SENDER, dst_eid_2, lib_address);

    let params1 = MessagingParams {
        dst_eid: dst_eid_1,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    let params2 = MessagingParams {
        dst_eid: dst_eid_2,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Send to first destination
    let result1 = endpoint.send(params1.clone(), REFUND_ADDRESS).unwrap();
    assert(result1.nonce == 1, 'First dest nonce should be 1');

    reapprove_tokens(token, endpoint_address, 2000_u256);

    // Send to second destination
    let result2 = endpoint.send(params2.clone(), REFUND_ADDRESS).unwrap();
    assert(result2.nonce == 1, 'Second dest nonce should be 1');

    // Re-approve tokens for third send
    reapprove_tokens(token, endpoint_address, 2000_u256);

    // Send again to first destination
    let result3 = endpoint.send(params1.clone(), REFUND_ADDRESS).unwrap();
    assert(result3.nonce == 2, 'First dest nonce should be 2');
}

#[test]
fn test_send_with_message_lib_failure() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Configure mock library to fail using the correct helper trait
    let lib_helpers = ISimpleMessageLibHelpersDispatcher { contract_address: lib_address };
    lib_helpers.set_should_fail(true);

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    let result = endpoint.send(params, REFUND_ADDRESS);
    assert_panic_with_error(result, lib_helpers.get_message_lib_failure());
}

#[test]
fn test_send_with_empty_message() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "",
        options: "test options",
        pay_in_lz_token: false,
    };

    let result = endpoint.send(params, REFUND_ADDRESS);
    assert(result.is_ok(), 'empty message should succeed');
}

#[test]
fn test_send_with_empty_options() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "",
        pay_in_lz_token: false,
    };

    let result = endpoint.send(params, REFUND_ADDRESS);
    assert(result.is_ok(), 'empty options should succeed');
}

#[test]
fn test_send_payment_flow() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    let lib_helpers = ISimpleMessageLibHelpersDispatcher { contract_address: lib_address };
    lib_helpers.set_use_mock_payees();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Record initial balances and allowance
    let sender_balance_before = token.balance_of(SENDER);
    let refund_balance_before = token.balance_of(REFUND_ADDRESS);
    let lib_balance_before = token.balance_of(lib_address);
    let endpoint_balance_before = token.balance_of(endpoint_address);
    let allowance_before = token.allowance(SENDER, endpoint_address);

    // Get mock payees from SimpleMessageLib
    let mock_payees = lib_helpers.get_mock_payees();
    let payee1_balance_before = token.balance_of(*mock_payees.at(0).receiver);
    let payee2_balance_before = token.balance_of(*mock_payees.at(1).receiver);

    let result = endpoint.send(params, REFUND_ADDRESS);
    stop_cheat_caller_address(endpoint_address);

    assert(result.is_ok(), SEND_SHOULD_SUCCEED);

    // Check that payments were made correctly
    let sender_balance_after = token.balance_of(SENDER);
    let refund_balance_after = token.balance_of(REFUND_ADDRESS);
    let lib_balance_after = token.balance_of(lib_address);
    let endpoint_balance_after = token.balance_of(endpoint_address);
    let allowance_after = token.allowance(SENDER, endpoint_address);
    let payee1_balance_after = token.balance_of(*mock_payees.at(0).receiver);
    let payee2_balance_after = token.balance_of(*mock_payees.at(1).receiver);

    // The sender should have paid the fee (1000 tokens as per mock)
    let expected_fee = lib_helpers.get_native_fee();
    assert(
        sender_balance_before - sender_balance_after == allowance_before, 'Sender should pay fee',
    );

    // The refund address should receive the remainder
    assert(
        refund_balance_after == (refund_balance_before + (allowance_before - expected_fee)),
        'Refund should receive remainder',
    );

    // The library should not receive tokens (since SimpleMessageLib has empty payees)
    assert(lib_balance_after == lib_balance_before, 'Library shouldnt get tokens');

    // The endpoint balance should remain unchanged
    assert(endpoint_balance_after == endpoint_balance_before, 'EndpointV2 balance unchanged');

    // The mock payees should receive their expected amounts
    let expected_payee1_amount = *mock_payees.at(0).native_amount;
    let expected_payee2_amount = *mock_payees.at(1).native_amount;
    assert(
        payee1_balance_after == payee1_balance_before + expected_payee1_amount,
        'Payee1 balance increase',
    );
    assert(
        payee2_balance_after == payee2_balance_before + expected_payee2_amount,
        'Payee2 balance increase',
    );

    // The allowance should be entirely consumed
    assert(allowance_after == 0, 'Allowance should be consumed');
    assert(allowance_before > 0, 'Should have had allowance');
    assert(
        allowance_before >= sender_balance_before - sender_balance_after, 'Allowance sufficient',
    );
}

#[test]
fn test_send_native_fee_exceeds_allowance() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    cheat_caller_address_once(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Set allowance to less than the native fee (1000 tokens)
    // First revoke existing allowance
    start_cheat_caller_address(token.contract_address, SENDER);
    token.approve(endpoint_address, 0);
    // Set insufficient allowance (native fee is 1000, so set to 500)
    token.approve(endpoint_address, lib_helpers.get_native_fee() / 2);
    stop_cheat_caller_address(token.contract_address);

    cheat_caller_address_once(endpoint_address, SENDER);
    let result = endpoint.send(params, REFUND_ADDRESS);

    assert_panic_with_error(
        result,
        errors::err_insufficient_fee(
            lib_helpers.get_native_fee(),
            lib_helpers.get_native_fee() / 2,
            SENDER_INITIAL_BALANCE,
            0,
            0,
            0,
        ),
    );
}

#[test]
fn test_send_zero_allowance() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    cheat_caller_address_once(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Set allowance to zero
    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, 0);

    cheat_caller_address_once(endpoint_address, SENDER);
    let result = endpoint.send(params, REFUND_ADDRESS);

    assert_panic_with_error(
        result,
        errors::err_insufficient_fee(
            lib_helpers.get_native_fee(), 0, SENDER_INITIAL_BALANCE, 0, 0, 0,
        ),
    );
}

#[test]
fn test_send_native_fee_exceeds_balance() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    cheat_caller_address_once(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, lib_helpers.get_native_fee());

    start_mock_call(
        token.contract_address, selector!("balance_of"), lib_helpers.get_native_fee() / 2,
    );

    cheat_caller_address_once(endpoint_address, SENDER);
    let result = endpoint.send(params, REFUND_ADDRESS);

    assert_panic_with_error(
        result,
        errors::err_insufficient_fee(
            lib_helpers.get_native_fee(),
            lib_helpers.get_native_fee(),
            lib_helpers.get_native_fee() / 2,
            0,
            0,
            0,
        ),
    );
}

#[test]
fn test_send_zro_fee_exceeds_balance() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set LZ (ZRO) token
    let (lz_token, lz_token_address) = deploy_mock_erc20();
    cheat_caller_address_once(endpoint_address, OWNER);
    endpoint.set_lz_token(lz_token_address).unwrap();

    lib_helpers.set_use_mock_mixed_payees();

    // Set send library for the sender
    cheat_caller_address_once(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: true,
    };

    lib_helpers.set_lz_token_fee(LZ_TOKEN_FEE);

    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, lib_helpers.get_native_fee());

    cheat_caller_address_once(lz_token_address, SENDER);
    lz_token.approve(endpoint_address, LZ_TOKEN_FEE);

    start_mock_call(lz_token.contract_address, selector!("balance_of"), LZ_TOKEN_FEE / 2);

    cheat_caller_address_once(endpoint_address, SENDER);
    let result = endpoint.send(params, REFUND_ADDRESS);

    assert_panic_with_error(
        result,
        errors::err_insufficient_fee(
            lib_helpers.get_native_fee(),
            lib_helpers.get_native_fee(),
            SENDER_INITIAL_BALANCE,
            LZ_TOKEN_FEE,
            LZ_TOKEN_FEE,
            LZ_TOKEN_FEE / 2,
        ),
    );
}

#[test]
fn test_send_zro_fee_exceeds_allowance() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set LZ (ZRO) token
    let (lz_token, lz_token_address) = deploy_mock_erc20();
    cheat_caller_address_once(endpoint_address, OWNER);
    endpoint.set_lz_token(lz_token_address).unwrap();

    lib_helpers.set_use_mock_mixed_payees();

    // Set send library for the sender
    cheat_caller_address_once(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: true,
    };

    lib_helpers.set_lz_token_fee(LZ_TOKEN_FEE);

    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, lib_helpers.get_native_fee());

    cheat_caller_address_once(lz_token_address, SENDER);
    lz_token.approve(endpoint_address, LZ_TOKEN_FEE / 2);

    start_mock_call(lz_token.contract_address, selector!("balance_of"), LZ_TOKEN_FEE);

    cheat_caller_address_once(endpoint_address, SENDER);
    let result = endpoint.send(params, REFUND_ADDRESS);

    assert_panic_with_error(
        result,
        errors::err_insufficient_fee(
            lib_helpers.get_native_fee(),
            lib_helpers.get_native_fee(),
            SENDER_INITIAL_BALANCE,
            LZ_TOKEN_FEE,
            LZ_TOKEN_FEE / 2,
            LZ_TOKEN_FEE,
        ),
    );
}

#[test]
fn test_send_exact_allowance_equals_fee() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Enable mock payees so we actually have payees to pay
    let lib_helpers = ISimpleMessageLibHelpersDispatcher { contract_address: lib_address };
    lib_helpers.set_use_mock_payees();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Set allowance to exactly match the native fee (1000 tokens)
    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, lib_helpers.get_native_fee());

    let refund_balance_before = token.balance_of(REFUND_ADDRESS);

    let result = endpoint.send(params, REFUND_ADDRESS);
    stop_cheat_caller_address(endpoint_address);

    assert(result.is_ok(), SEND_SHOULD_SUCCEED);

    // Check that refund address receives no tokens (since allowance exactly equals fee)
    let refund_balance_after = token.balance_of(REFUND_ADDRESS);
    assert(refund_balance_after == refund_balance_before, 'No refund for exact allowance');

    // Check that allowance is fully consumed
    let allowance_after = token.allowance(SENDER, endpoint_address);
    assert(allowance_after == 0, 'Allowance should be consumed');
}

#[test]
fn test_send_with_zero_payees() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Ensure mock payees are disabled (default behavior)
    let lib_helpers = ISimpleMessageLibHelpersDispatcher { contract_address: lib_address };
    lib_helpers.disable_mock_payees();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    let refund_balance_before = token.balance_of(REFUND_ADDRESS);
    let allowance_before = token.allowance(SENDER, endpoint_address);

    let result = endpoint.send(params, REFUND_ADDRESS);
    assert(result.is_ok(), SEND_SHOULD_SUCCEED);

    // With no payees, the entire allowance should go to refund address
    let refund_balance_after = token.balance_of(REFUND_ADDRESS);
    assert(
        refund_balance_after == refund_balance_before + allowance_before,
        'rem allowance wasnt refunded',
    );
}

#[test]
fn test_send_with_same_sender_and_refund_address() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, lib_helpers, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    let sender_balance_before = token.balance_of(SENDER);

    // Use SENDER as refund address and only approve the fee
    token.approve(endpoint_address, lib_helpers.get_native_fee());
    let result = endpoint.send(params, SENDER);
    assert(result.is_ok(), SEND_SHOULD_SUCCEED);

    // Sender should only lose the fee amount (1000 tokens)
    let sender_balance_after = token.balance_of(SENDER);
    assert(
        sender_balance_after == sender_balance_before - lib_helpers.get_native_fee(),
        'Sender should only lose fee',
    );
}

#[test]
fn test_send_with_very_large_message() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    // Create a very large message
    let mut large_message: ByteArray = Default::default();
    let mut i = 0;
    while i != 1000 {
        large_message
            .append(
                @"This is a very long message that will test the system's ability to handle large payloads. ",
            );
        i += 1;
    }

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: large_message,
        options: "test options",
        pay_in_lz_token: false,
    };

    let result = endpoint.send(params, REFUND_ADDRESS);
    assert(result.is_ok(), 'Large message should succeed');
}

#[test]
fn test_send_with_zero_destination_eid() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for destination EID 0
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, 0, lib_address);

    let params = MessagingParams {
        dst_eid: 0,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    let result = endpoint.send(params, REFUND_ADDRESS);
    assert(result.is_ok(), 'Zero dst_eid should succeed');
}

#[test]
fn test_send_with_zero_address_receiver() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: ZERO_ADDRESS.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    let result = endpoint.send(params, REFUND_ADDRESS);
    assert(result.is_ok(), 'Zero receiver should succeed');
}

#[test]
fn test_send_with_zero_address_refund() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Use zero address as refund address
    let result = endpoint.send(params, 0.try_into().unwrap());
    assert_panic_with_felt_error(result, TRANSFER_TO_ZERO);
}

#[test]
fn test_send_nonce_overflow_protection() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "test message",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Send a reasonable number of messages to test nonce increments
    let mut nonce = 1;
    while nonce != 10 {
        if nonce > 1 {
            reapprove_tokens(token, endpoint_address, 2000_u256);
        }

        let result = endpoint.send(params.clone(), REFUND_ADDRESS);
        assert(result.is_ok(), 'Send should succeed');
        let receipt = result.unwrap();
        assert(receipt.nonce == nonce, 'Nonce didnt increment correctly');
        nonce += 1;
    }
}

#[test]
fn test_send_consecutive_same_receiver_nonce_tracking() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    // Send to receiver1
    let params1 = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "message to receiver1",
        options: "test options",
        pay_in_lz_token: false,
    };

    let result1 = endpoint.send(params1.clone(), REFUND_ADDRESS);
    assert(result1.is_ok(), 'First send should succeed');
    assert(result1.unwrap().nonce == 1, 'First nonce should be 1');

    reapprove_tokens(token, endpoint_address, 2000_u256);

    // Send to receiver2
    let params2 = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER_2.into(),
        message: "message to receiver2",
        options: "test options",
        pay_in_lz_token: false,
    };

    let result2 = endpoint.send(params2, REFUND_ADDRESS);
    assert(result2.is_ok(), 'Second send should succeed');
    assert(result2.unwrap().nonce == 1, 'Second nonce should be 1');

    reapprove_tokens(token, endpoint_address, 2000_u256);

    // Send again to receiver1
    let result3 = endpoint.send(params1, REFUND_ADDRESS);
    assert(result3.is_ok(), 'Third send should succeed');
    assert(result3.unwrap().nonce == 2, 'Third nonce should be 2');
}

#[test]
fn send_fails_when_native_transfer_fails() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, token, message_lib_manager, ..,
    } = setup_with_registered_library();

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    // SENDER approves endpoint to spend tokens
    cheat_caller_address_once(token.contract_address, SENDER);
    token.approve(endpoint_address, SENDER_INITIAL_BALANCE);

    // Send to receiver
    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "message to receiver",
        options: "test options",
        pay_in_lz_token: false,
    };

    // Transfer fails
    start_mock_call(token.contract_address, selector!("transfer_from"), false);
    let result = endpoint.send(params, REFUND_ADDRESS);

    // Check send fails when transfer fails
    assert_panic_with_error(result, errors::err_native_transfer_failed());
}

#[test]
fn send_fails_when_zro_transfer_fails() {
    let SetupResult {
        endpoint, endpoint_address, lib_address, message_lib_manager, ..,
    } = setup_with_registered_library();

    let lib_helpers = ISimpleMessageLibHelpersDispatcher { contract_address: lib_address };
    lib_helpers.set_use_mock_lz_payees();

    // Set LZ (ZRO) token
    let (lz_token, lz_token_address) = deploy_mock_erc20();
    cheat_caller_address_once(endpoint_address, OWNER);
    endpoint.set_lz_token(lz_token_address).unwrap();

    // SENDER approves endpoint to spend ZRO tokens
    cheat_caller_address_once(lz_token_address, SENDER);
    lz_token.approve(endpoint_address, SENDER_INITIAL_BALANCE);
    cheat_caller_address_once(lz_token_address, OWNER);
    lz_token.transfer(SENDER, SENDER_INITIAL_BALANCE);

    // Set send library for the sender
    start_cheat_caller_address(endpoint_address, SENDER);
    message_lib_manager.set_send_library(SENDER, DST_EID, lib_address);

    // Send to receiver
    let params = MessagingParams {
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        message: "message to receiver",
        options: "test options",
        pay_in_lz_token: true,
    };

    // Transfer fails
    start_mock_call(lz_token_address, selector!("transfer_from"), false);
    let result = endpoint.send(params, REFUND_ADDRESS);

    // Check send fails when transfer fails
    assert_panic_with_error(result, errors::err_zro_transfer_failed());
}

///////////////////
// Setters tests //
///////////////////

#[test]
fn test_set_lz_token() {
    let SetupResult { endpoint, endpoint_address, .. } = setup_with_registered_library();
    start_cheat_caller_address(endpoint_address, OWNER);
    let lz_token = endpoint.get_lz_token().unwrap();
    assert(lz_token.is_zero(), 'lz_token should be 0');

    endpoint.set_lz_token(LZ_TOKEN).unwrap();

    let lz_token = endpoint.get_lz_token().unwrap();
    assert(lz_token == LZ_TOKEN, 'lz_token should be the same');
}

#[test]
fn test_set_lz_token_invalid_address() {
    let SetupResult { endpoint, endpoint_address, token, .. } = setup_with_registered_library();
    start_cheat_caller_address(endpoint_address, OWNER);
    let result = endpoint.set_lz_token(token.contract_address);
    assert_panic_with_error(result, errors::err_invalid_lz_token_address(token.contract_address));
}

#[test]
fn test_set_delegate() {
    let (_, token_address) = deploy_mock_erc20();
    let (endpoint, endpoint_address) = deploy_endpoint_with_token(token_address);

    let mut spy = spy_events();

    start_cheat_caller_address(endpoint_address, SENDER);
    let _ = endpoint.set_delegate(DELEGATE);
    stop_cheat_caller_address(endpoint_address);

    let delegate = endpoint.get_delegate(SENDER).unwrap();
    assert(delegate == DELEGATE, 'delegate should be the same');

    let delegate_event = EndpointV2::Event::DelegateSet(
        DelegateSet { oapp: SENDER, delegate: DELEGATE },
    );
    spy.assert_emitted(@array![(endpoint_address, delegate_event)]);
}
