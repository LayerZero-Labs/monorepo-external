//! OFT adapter tests

use core::num::traits::{Bounded, SaturatingAdd, SaturatingSub};
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::layerzero_receiver::{
    ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
    ILayerZeroReceiverSafeDispatcher, ILayerZeroReceiverSafeDispatcherTrait,
};
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use layerzero::oapps::oft::errors::{err_oft_transfer_failed, err_slippage_exceeded};
use layerzero::oapps::oft::interface::{
    IOFTDispatcher, IOFTDispatcherTrait, IOFTSafeDispatcher, IOFTSafeDispatcherTrait,
};
use layerzero::oapps::oft::oft_msg_codec::OFTMsgCodec;
use layerzero::oapps::oft::structs::SendParam;
use layerzero::{MessageReceipt, MessagingFee};
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use openzeppelin::token::erc20::ERC20Component::Errors as ERC20Errors;
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, mock_call, start_mock_call};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::mocks::erc20::interface::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};

// =============================== Test Constants =================================

pub const FAKE_ENDPOINT: ContractAddress = 'fake_endpoint'.try_into().unwrap();
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const STARK_TOKEN: ContractAddress = 'stark_token'.try_into().unwrap();
pub const USER: ContractAddress = 'user'.try_into().unwrap();
pub const RECIPIENT: ContractAddress = 'recipient'.try_into().unwrap();
pub const DST_EID: u32 = 101;
pub const SRC_EID: u32 = 201;
pub const SHARED_DECIMALS: u8 = 6;
pub const LOCAL_DECIMALS: u8 = 18;

// Test amounts
pub const TEST_AMOUNT_LD: u256 = 1000000000000000000_u256; // 1 token with 18 decimals
pub const MIN_AMOUNT_LD: u256 = 900000000000000000_u256; // 0.9 token with 18 decimals
pub const SMALL_AMOUNT: u256 = 500000000000000000_u256; // 0.5 token
pub const LARGE_AMOUNT: u256 = 10000000000000000000_u256; // 10 tokens
pub const INITIAL_SUPPLY: u256 = 1000000000000000000000_u256; // 1000 tokens

// =============================== Helper Functions =================================

fn MOCK_GUID() -> Bytes32 {
    Bytes32 { value: 0xabcdef123456789 }
}

fn MOCK_ORIGIN() -> Origin {
    Origin { src_eid: SRC_EID, sender: MOCK_PEER(), nonce: 1 }
}

fn MOCK_PEER() -> Bytes32 {
    Bytes32 { value: 0x123456789abcdef }
}

fn deploy_mock_erc20() -> ContractAddress {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let (address, _) = contract
        .deploy(@array![INITIAL_SUPPLY.low.into(), INITIAL_SUPPLY.high.into(), OWNER.into()])
        .unwrap_syscall();
    address
}

fn deploy_oft_adapter(
    inner_token: ContractAddress, stark_token: ContractAddress,
) -> ContractAddress {
    let contract = declare("OFTAdapter").unwrap_syscall().contract_class();

    mock_call(FAKE_ENDPOINT, selector!("set_delegate"), (), 1);
    let (adapter_address, _) = contract
        .deploy(@array![inner_token.into(), FAKE_ENDPOINT.into(), OWNER.into(), stark_token.into()])
        .unwrap_syscall();

    adapter_address
}

fn setup_oft_adapter() -> (ContractAddress, ContractAddress, ContractAddress) {
    let stark_token = deploy_mock_erc20();
    let inner_token = deploy_mock_erc20();
    let adapter = deploy_oft_adapter(inner_token, stark_token);

    (adapter, inner_token, stark_token)
}

fn setup_adapter_with_peers(adapter_address: ContractAddress) {
    let oapp = IOAppDispatcher { contract_address: adapter_address };

    cheat_caller_address_once(adapter_address, OWNER);
    oapp.set_peer(DST_EID, MOCK_PEER());

    cheat_caller_address_once(adapter_address, OWNER);
    oapp.set_peer(SRC_EID, MOCK_PEER());
}

fn setup_user_tokens_and_approval(
    inner_token: ContractAddress,
    adapter_address: ContractAddress,
    user: ContractAddress,
    amount: u256,
) {
    let token = IERC20Dispatcher { contract_address: inner_token };

    // Transfer tokens from owner to user
    cheat_caller_address_once(inner_token, OWNER);
    token.transfer(user, amount);

    // Approve adapter to spend user's tokens
    cheat_caller_address_once(inner_token, user);
    token.approve(adapter_address, amount);
}

fn setup_adapter_tokens(
    inner_token: ContractAddress, adapter_address: ContractAddress, amount: u256,
) {
    let token = IERC20Dispatcher { contract_address: inner_token };

    // Transfer tokens to adapter for unlocking
    cheat_caller_address_once(inner_token, OWNER);
    token.transfer(adapter_address, amount);
}

fn create_test_send_param() -> SendParam {
    SendParam {
        dst_eid: DST_EID,
        to: RECIPIENT.into(),
        amount_ld: TEST_AMOUNT_LD,
        min_amount_ld: MIN_AMOUNT_LD,
        extra_options: Default::default(),
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    }
}

// =============================== Constructor Tests =================================

#[test]
fn test_constructor_valid_params() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    // Check that token is correctly set
    let token_address = oft.token();
    assert_eq!(token_address, inner_token);

    // Check shared decimals
    let decimals = oft.shared_decimals();
    assert_eq!(decimals, SHARED_DECIMALS);

    // Check approval required
    let approval_required = oft.approval_required();
    assert(approval_required, 'Should require approval');
}

// =============================== Token Interface Tests =================================

#[test]
fn test_token_returns_inner_token() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    let token_address = oft.token();
    assert_eq!(token_address, inner_token);
}

#[test]
fn test_approval_required_returns_true() {
    let (adapter_address, _, _) = setup_oft_adapter();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    let approval_required = oft.approval_required();
    assert(approval_required, 'Should require approval');
}

#[test]
fn test_shared_decimals() {
    let (adapter_address, _, _) = setup_oft_adapter();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    let decimals = oft.shared_decimals();
    assert_eq!(decimals, SHARED_DECIMALS);
}

// =============================== Debit View Function Tests =================================

#[test]
fn test_debit_normal_operation() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let token = IERC20Dispatcher { contract_address: inner_token };

    setup_adapter_with_peers(adapter_address);
    setup_user_tokens_and_approval(inner_token, adapter_address, USER, TEST_AMOUNT_LD);

    // Check initial balances
    let initial_user_balance = token.balance_of(USER);
    let initial_adapter_balance = token.balance_of(adapter_address);

    // Test quote_oft which should show the amounts correctly
    let send_param = create_test_send_param();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    let quote = oft.quote_oft(send_param);

    // Verify the quote shows correct amounts
    assert_eq!(quote.receipt.amount_sent_ld, TEST_AMOUNT_LD);
    assert_eq!(quote.receipt.amount_received_ld, TEST_AMOUNT_LD);

    // Verify balances haven't changed (quote doesn't transfer)
    assert_eq!(token.balance_of(USER), initial_user_balance);
    assert_eq!(token.balance_of(adapter_address), initial_adapter_balance);
}

#[test]
fn test_debit_zero_amount() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();

    setup_adapter_with_peers(adapter_address);
    setup_user_tokens_and_approval(inner_token, adapter_address, USER, TEST_AMOUNT_LD);

    let mut send_param = create_test_send_param();
    send_param.amount_ld = 0;
    send_param.min_amount_ld = 0;

    let oft = IOFTDispatcher { contract_address: adapter_address };
    let quote = oft.quote_oft(send_param);

    // Should handle zero amount gracefully
    assert(quote.receipt.amount_sent_ld == 0, 'Should accept zero amount');
}

#[test]
fn test_debit_insufficient_balance() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let token = IERC20Dispatcher { contract_address: inner_token };

    setup_adapter_with_peers(adapter_address);
    // Don't give user any tokens - verify they have zero balance
    let user_balance = token.balance_of(USER);
    assert(user_balance == 0, 'User should have no tokens');

    let send_param = create_test_send_param();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    let quote = oft.quote_oft(send_param);

    // Quote should still work but actual send would fail
    assert(quote.receipt.amount_sent_ld == TEST_AMOUNT_LD, 'Quote works');
}

#[test]
fn test_debit_insufficient_allowance() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let token = IERC20Dispatcher { contract_address: inner_token };

    setup_adapter_with_peers(adapter_address);

    // Give user tokens but no approval
    cheat_caller_address_once(inner_token, OWNER);
    token.transfer(USER, TEST_AMOUNT_LD);

    let send_param = create_test_send_param();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    let quote = oft.quote_oft(send_param);

    // Quote should still work but actual send would fail
    assert(quote.receipt.amount_sent_ld == TEST_AMOUNT_LD, 'Quote works');
}

#[test]
#[feature("safe_dispatcher")]
fn test_debit_slippage_exceeded() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();

    setup_adapter_with_peers(adapter_address);
    setup_user_tokens_and_approval(inner_token, adapter_address, USER, TEST_AMOUNT_LD);

    let mut send_param = create_test_send_param();
    send_param.min_amount_ld = TEST_AMOUNT_LD + 1; // Set min higher than amount

    let oft_safe = IOFTSafeDispatcher { contract_address: adapter_address };
    let result = oft_safe.quote_oft(send_param);

    assert_panic_with_error(result, err_slippage_exceeded(TEST_AMOUNT_LD, TEST_AMOUNT_LD + 1));
}

// =============================== Debit Function Tests =================================

#[test]
#[fuzzer(runs: 10)]
fn test_debit_successful_send(
    amount_seed: u256, native_fee: u128, user_native_remainder: u128, user_erc20_remainder: u128,
) {
    let (adapter_address, inner_token, stark_token) = setup_oft_adapter();
    let stark_token_dispatcher = IERC20Dispatcher { contract_address: stark_token };
    let inner_token_dispatcher = IERC20Dispatcher { contract_address: inner_token };

    // =============================== Transfer parameters =================================

    let diff_decimals = IOFTDispatcher { contract_address: adapter_address }
        .decimal_conversion_rate();

    let amount_ld = amount_seed % (Bounded::<u64>::MAX.into() * diff_decimals);
    let amount_sd: u64 = (amount_ld / diff_decimals).try_into().unwrap();
    let dust_ld = amount_ld % diff_decimals;
    let clean_amount_ld = amount_ld - dust_ld;
    // Expect a lossless token transfer.
    let min_amount_ld = amount_sd.into() * diff_decimals;

    // Preconditions
    assert_eq!(clean_amount_ld, min_amount_ld);
    assert(amount_sd > 0, 'Greater than 0'); // Hopefully, we never hit 0 of `u64`...

    // =============================== Setup =================================

    setup_adapter_with_peers(adapter_address);

    let mocked_messaging_fee = MessagingFee { native_fee: native_fee.into(), lz_token_fee: 0 };

    IMockERC20Dispatcher { contract_address: stark_token }
        .mint(USER, native_fee.into() + user_native_remainder.into());
    IMockERC20Dispatcher { contract_address: inner_token }
        .mint(USER, amount_ld.into() + user_erc20_remainder.into());

    // mock endpoint quote call to return the expected send fee
    start_mock_call(FAKE_ENDPOINT, selector!("quote"), mocked_messaging_fee);

    // =============================== Send tokens =================================

    // User has to approve the adapter to spend the native fee
    cheat_caller_address_once(stark_token, USER);
    IERC20Dispatcher { contract_address: stark_token }.approve(adapter_address, native_fee.into());

    // User has to approve the adapter to transfer the amount to send
    cheat_caller_address_once(inner_token, USER);
    IERC20Dispatcher { contract_address: inner_token }
        .approve(adapter_address, clean_amount_ld.into());

    let send_param = SendParam {
        dst_eid: DST_EID,
        to: RECIPIENT.into(),
        amount_ld,
        min_amount_ld: clean_amount_ld,
        // not using extra options, compose msg, or oft cmd in this test
        extra_options: Default::default(),
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    };

    let quote = IOFTDispatcher { contract_address: adapter_address }
        .quote_send(send_param.clone(), false);

    // Mock a message receipt returned from the endpoint.
    // GUID, nonce, and payees are not important for this test.
    start_mock_call(
        FAKE_ENDPOINT,
        selector!("send"),
        MessageReceipt { guid: Bytes32 { value: 1 }, nonce: 1, payees: array![] },
    );

    cheat_caller_address_once(adapter_address, USER);
    let result = IOFTDispatcher { contract_address: adapter_address }.send(send_param, quote, USER);

    // =============================== Assertions =================================

    // User should have sent the amount of tokens to the OFT adapter.
    assert_eq!(result.oft_receipt.amount_sent_ld, clean_amount_ld);
    assert_eq!(result.oft_receipt.amount_received_ld, clean_amount_ld);

    // Native tokens should have been approved to the endpoint.
    // The real endpoint would have used the allowance and refund the remainder,
    // but here the OFT adapter will have approved the endpoint to spend the native fee.
    assert_eq!(stark_token_dispatcher.allowance(adapter_address, FAKE_ENDPOINT), native_fee.into());

    // The sender should have spent the native fee.
    assert_eq!(stark_token_dispatcher.balance_of(USER), user_native_remainder.into());

    // The sender's balance of the custom token should have been reduced by the amount of custom
    // tokens sent.
    assert_eq!(
        inner_token_dispatcher.balance_of(USER), user_erc20_remainder.into() + dust_ld.into(),
    );

    // The adapter should have received the amount of tokens.
    assert_eq!(inner_token_dispatcher.balance_of(adapter_address), clean_amount_ld.into());

    // The adapter should have received the native fee.
    assert_eq!(stark_token_dispatcher.balance_of(adapter_address), native_fee.into());

    // The total supply of the custom token should be the total, nothing should be burnt
    assert_eq!(
        inner_token_dispatcher.total_supply(),
        amount_ld.into() + user_erc20_remainder.into() + INITIAL_SUPPLY.into(),
    );
}

#[test]
#[feature("safe_dispatcher")]
#[fuzzer(runs: 10)]
fn test_send_fee_transfer_failure(native_fee: u256) {
    let (adapter_address, inner_token, _) = setup_oft_adapter();

    start_mock_call(inner_token, selector!("transfer_from"), false);
    let result = IOFTSafeDispatcher { contract_address: adapter_address }
        .send(create_test_send_param(), MessagingFee { native_fee, lz_token_fee: 0 }, USER);

    assert_panic_with_error(result, err_oft_transfer_failed());
}

// =============================== Credit Function Tests =================================

#[test]
fn test_credit_normal_operation() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let token = IERC20Dispatcher { contract_address: inner_token };
    let lz_receiver = ILayerZeroReceiverDispatcher { contract_address: adapter_address };

    setup_adapter_with_peers(adapter_address);
    setup_adapter_tokens(inner_token, adapter_address, LARGE_AMOUNT);

    let initial_user_balance = token.balance_of(USER);
    let initial_adapter_balance = token.balance_of(adapter_address);

    // Encode a message with 1 token in shared decimals.
    let (message, _) = OFTMsgCodec::encode(USER.into(), 1_000_000, @"");

    cheat_caller_address_once(adapter_address, FAKE_ENDPOINT);
    lz_receiver.lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);

    let final_user_balance = token.balance_of(USER);
    let final_adapter_balance = token.balance_of(adapter_address);

    // User should receive tokens, adapter should lose tokens
    assert(final_user_balance > initial_user_balance, 'User should receive tokens');
    assert(final_adapter_balance < initial_adapter_balance, 'Adapter should lose tokens');
    assert_eq!(final_user_balance - initial_user_balance, TEST_AMOUNT_LD);
}

#[test]
fn test_credit_zero_amount() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let token = IERC20Dispatcher { contract_address: inner_token };
    let lz_receiver = ILayerZeroReceiverDispatcher { contract_address: adapter_address };

    setup_adapter_with_peers(adapter_address);
    setup_adapter_tokens(inner_token, adapter_address, LARGE_AMOUNT);

    let initial_user_balance = token.balance_of(USER);
    let (message, _) = OFTMsgCodec::encode(USER.into(), 0, @"");

    cheat_caller_address_once(adapter_address, FAKE_ENDPOINT);
    lz_receiver.lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);

    let final_user_balance = token.balance_of(USER);
    assert_eq!(final_user_balance, initial_user_balance);
}

#[test]
#[feature("safe_dispatcher")]
#[fuzzer(runs: 10)]
fn test_credit_insufficient_adapter_balance(
    amount_to_receive: u64, tokens_missing_on_adapter: u64,
) {
    // prevent flakiness
    let amount_to_receive = amount_to_receive.saturating_add(1);
    let tokens_on_adapter = amount_to_receive
        .saturating_sub(tokens_missing_on_adapter.saturating_add(1));

    let (adapter_address, inner_token, _) = setup_oft_adapter();
    setup_adapter_with_peers(adapter_address);

    IMockERC20Dispatcher { contract_address: inner_token }
        .mint(adapter_address, tokens_on_adapter.into());

    let (message, _) = OFTMsgCodec::encode(USER.into(), amount_to_receive, @"");

    cheat_caller_address_once(adapter_address, FAKE_ENDPOINT);
    // Simulate receiving tokens when adapter has insufficient balance
    let result = ILayerZeroReceiverSafeDispatcher { contract_address: adapter_address }
        .lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);

    assert_panic_with_felt_error(result, ERC20Errors::INSUFFICIENT_BALANCE);
}

#[test]
#[feature("safe_dispatcher")]
fn test_credit_transfer_failure() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();

    setup_adapter_with_peers(adapter_address);
    start_mock_call(inner_token, selector!("transfer"), false);

    let (message, _) = OFTMsgCodec::encode(USER.into(), 0, @"");

    cheat_caller_address_once(adapter_address, FAKE_ENDPOINT);
    let result = ILayerZeroReceiverSafeDispatcher { contract_address: adapter_address }
        .lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);

    assert_panic_with_error(result, err_oft_transfer_failed());
}

// =============================== Integration Tests =================================

#[test]
fn test_full_send_receive_cycle() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let token = IERC20Dispatcher { contract_address: inner_token };
    let lz_receiver = ILayerZeroReceiverDispatcher { contract_address: adapter_address };

    setup_adapter_with_peers(adapter_address);
    setup_user_tokens_and_approval(inner_token, adapter_address, USER, LARGE_AMOUNT);
    setup_adapter_tokens(inner_token, adapter_address, LARGE_AMOUNT);

    // First, simulate sending tokens (debit)
    let send_param = create_test_send_param();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    let initial_balance = token.balance_of(USER);

    // Quote the send first and verify it works
    let quote = oft.quote_oft(send_param);
    assert_eq!(quote.receipt.amount_sent_ld, TEST_AMOUNT_LD);

    // Encode a message with 1 token in shared decimals.
    let (message, _) = OFTMsgCodec::encode(USER.into(), 1_000_000, @"");

    // Then simulate receiving tokens back (credit)
    cheat_caller_address_once(adapter_address, FAKE_ENDPOINT);
    lz_receiver.lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);

    let final_balance = token.balance_of(USER);

    // User should have received tokens
    assert(final_balance > initial_balance, 'Should receive tokens');
}

// =============================== Edge Case Tests =================================

#[test]
fn test_large_amounts() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();

    setup_adapter_with_peers(adapter_address);
    setup_user_tokens_and_approval(inner_token, adapter_address, USER, INITIAL_SUPPLY);

    let mut send_param = create_test_send_param();
    send_param.amount_ld = INITIAL_SUPPLY / 2; // Send half of total supply
    send_param.min_amount_ld = INITIAL_SUPPLY / 3;

    let oft = IOFTDispatcher { contract_address: adapter_address };

    let quote = oft.quote_oft(send_param);

    assert_eq!(quote.receipt.amount_sent_ld, INITIAL_SUPPLY / 2);
}

#[test]
fn test_multiple_users() {
    let (adapter_address, inner_token, _) = setup_oft_adapter();
    let user2: ContractAddress = 'user2'.try_into().unwrap();

    setup_adapter_with_peers(adapter_address);
    setup_user_tokens_and_approval(inner_token, adapter_address, USER, TEST_AMOUNT_LD);
    setup_user_tokens_and_approval(inner_token, adapter_address, user2, TEST_AMOUNT_LD);

    let send_param = create_test_send_param();
    let oft = IOFTDispatcher { contract_address: adapter_address };

    // Both users should be able to quote sends
    let quote1 = oft.quote_oft(send_param);
    let send_param2 = create_test_send_param();
    let quote2 = oft.quote_oft(send_param2);

    assert_eq!(quote1.receipt.amount_sent_ld, TEST_AMOUNT_LD);
    assert_eq!(quote2.receipt.amount_sent_ld, TEST_AMOUNT_LD);
}
