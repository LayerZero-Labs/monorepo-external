//! OFT core tests

use layerzero::common::constants::DEAD_ADDRESS;
use layerzero::common::structs::messaging::MessagingFee;
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::layerzero_receiver::{
    ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
};
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use layerzero::oapps::oft::errors::{
    err_amount_sd_overflowed, err_invalid_local_decimals, err_slippage_exceeded,
};
use layerzero::oapps::oft::events::MsgInspectorSet;
use layerzero::oapps::oft::interface::{
    IOFTDispatcher, IOFTDispatcherTrait, IOFTSafeDispatcher, IOFTSafeDispatcherTrait,
};
use layerzero::oapps::oft::oft_core::oft_core::OFTCoreComponent::Event as OFTEvent;
use layerzero::oapps::oft::structs::SendParam;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use openzeppelin::access::ownable::OwnableComponent;
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, mock_call, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, assert_panic_with_felt_error};
use crate::mocks::oft_core::interface::{
    IMockOFTCoreDispatcher, IMockOFTCoreDispatcherTrait, IMockOFTCoreSafeDispatcher,
    IMockOFTCoreSafeDispatcherTrait,
};

// =============================== Test Constants =================================

pub const FAKE_ENDPOINT: ContractAddress = 'fake_endpoint'.try_into().unwrap();
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const STARK_TOKEN: ContractAddress = 'stark_token'.try_into().unwrap();
pub const USER: ContractAddress = 'user'.try_into().unwrap();
pub const RECIPIENT: ContractAddress = 'recipient'.try_into().unwrap();
pub const REFUND_ADDRESS: ContractAddress = 'refund'.try_into().unwrap();
pub const DST_EID: u32 = 101;
pub const SRC_EID: u32 = 201;
pub const SHARED_DECIMALS: u8 = 6;
pub const LOCAL_DECIMALS: u8 = 18;

// Test amounts
pub const TEST_AMOUNT_LD: u256 = 1000000000000000000_u256; // 1 token with 18 decimals
pub const TEST_AMOUNT_SD: u64 = 1000000_u64; // 1 token with 6 decimals
pub const MIN_AMOUNT_LD: u256 = 900000000000000000_u256; // 0.9 token with 18 decimals
pub const DUST_AMOUNT: u256 = 1000000000000000123_u256; // Amount with dust
pub const CLEAN_AMOUNT: u256 = 1000000000000000000_u256; // Amount without dust

// Error messages handled by imported error functions

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
        .deploy(
            @array![
                1000000000000000000_u256.low.into(), 1000000000000000000_u256.high.into(),
                OWNER.into(),
            ],
        )
        .unwrap_syscall();
    address
}

fn deploy_mock_oft_core() -> (ContractAddress, ContractAddress) {
    let stark_token = deploy_mock_erc20();
    let contract = declare("MockOFTCore").unwrap_syscall().contract_class();
    let name: ByteArray = "MockOFT";
    let symbol: ByteArray = "MOFT";
    let endpoint: ContractAddress = FAKE_ENDPOINT;
    let owner: ContractAddress = OWNER;
    let native_token: ContractAddress = stark_token;
    let use_mock_decimal_conversion_rate = true;

    let mut params = array![];

    name.serialize(ref params);
    symbol.serialize(ref params);
    endpoint.serialize(ref params);
    owner.serialize(ref params);
    native_token.serialize(ref params);
    use_mock_decimal_conversion_rate.serialize(ref params);

    mock_call(FAKE_ENDPOINT, selector!("set_delegate"), (), 1);

    let (address, _) = contract.deploy(@params).unwrap_syscall();

    (address, stark_token)
}

fn deploy_mock_message_inspector() -> ContractAddress {
    let contract = declare("MockMessageInspector").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap_syscall();
    address
}

fn setup_oft_with_peers(oft_address: ContractAddress) {
    let oapp = IOAppDispatcher { contract_address: oft_address };

    start_cheat_caller_address(oft_address, OWNER);
    oapp.set_peer(DST_EID, MOCK_PEER());
    oapp.set_peer(SRC_EID, MOCK_PEER());
    stop_cheat_caller_address(oft_address);
}

fn mint_tokens_to_user(oft_address: ContractAddress, user: ContractAddress, amount_sd: u64) {
    let lz_receiver = ILayerZeroReceiverDispatcher { contract_address: oft_address };
    let mut message: ByteArray = Default::default();
    let user_bytes32: Bytes32 = user.into();
    message.append_u256(user_bytes32.value);
    message.append_u64(amount_sd);

    start_cheat_caller_address(oft_address, FAKE_ENDPOINT);
    lz_receiver.lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, user, Default::default(), 0);
    stop_cheat_caller_address(oft_address);
}

fn setup_native_fee_payment(
    stark_token_address: ContractAddress,
    oft_address: ContractAddress,
    user: ContractAddress,
    fee_amount: u256,
) {
    let stark_erc20 = IERC20Dispatcher { contract_address: stark_token_address };

    start_cheat_caller_address(stark_token_address, OWNER);
    stark_erc20.transfer(user, fee_amount * 100);
    stop_cheat_caller_address(stark_token_address);

    start_cheat_caller_address(stark_token_address, user);
    stark_erc20.approve(oft_address, fee_amount * 100);
    stop_cheat_caller_address(stark_token_address);
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

fn create_test_send_param_with_extra_options() -> SendParam {
    SendParam {
        dst_eid: DST_EID,
        to: RECIPIENT.into(),
        amount_ld: TEST_AMOUNT_LD,
        min_amount_ld: MIN_AMOUNT_LD,
        extra_options: "extra_options",
        compose_msg: Default::default(),
        oft_cmd: Default::default(),
    }
}

fn create_test_send_param_with_compose() -> SendParam {
    let mut compose_msg: ByteArray = Default::default();
    compose_msg.append(@"test compose message");

    SendParam {
        dst_eid: DST_EID,
        to: RECIPIENT.into(),
        amount_ld: TEST_AMOUNT_LD,
        min_amount_ld: MIN_AMOUNT_LD,
        extra_options: Default::default(),
        compose_msg,
        oft_cmd: Default::default(),
    }
}

// =============================== Basic Interface Tests =================================

#[test]
fn test_oft_version() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft = IOFTDispatcher { contract_address: oft_address };

    let version = oft.oft_version();
    assert(version.interface_id == 1_u32, 'Wrong interface ID');
    assert(version.version == 1_u64, 'Wrong version');
}

#[test]
fn test_token_address() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft = IOFTDispatcher { contract_address: oft_address };

    let token_address = oft.token();
    assert(token_address == oft_address, 'Token address should be self');
}

#[test]
fn test_approval_not_required() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft = IOFTDispatcher { contract_address: oft_address };

    let approval_required = oft.approval_required();
    assert(!approval_required, 'Approval not required');
}

#[test]
fn test_shared_decimals() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft = IOFTDispatcher { contract_address: oft_address };

    let decimals = oft.shared_decimals();
    assert(decimals == SHARED_DECIMALS, 'Wrong shared decimals');
}

// =============================== Initialization Tests =================================

#[test]
fn test_initializer_valid_decimals() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let conversion_rate = mock.test_decimal_conversion_rate();

    assert(conversion_rate == 1000000000000_u256, 'Wrong conversion rate');
}

#[test]
fn test_initializer_same_decimals() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(6);
    stop_cheat_caller_address(mock_address);

    // this will be 1 since the shared decimals are 6 and the local decimals are 6
    let conversion_rate = mock.test_decimal_conversion_rate();
    assert(conversion_rate == 1_u256, 'Rate should be 1');
}

#[test]
#[feature("safe_dispatcher")]
fn test_initializer_invalid_decimals() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock_safe = IMockOFTCoreSafeDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);

    let result = mock_safe.test_initializer(5); // local < shared (invalid)

    stop_cheat_caller_address(mock_address);

    assert_panic_with_error(result, err_invalid_local_decimals(5, 6));
}

// =============================== Decimal Conversion Tests =================================

#[test]
fn test_to_ld_conversion() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let amount_ld = mock.test_to_ld(1_u64);
    assert(amount_ld == 1000000000000_u256, 'Wrong _to_ld conversion');

    let large_amount_ld = mock.test_to_ld(1000000_u64);
    assert(large_amount_ld == 1000000000000000000_u256, 'Wrong large conversion');
}

#[test]
fn test_to_sd_conversion() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let amount_sd = mock.test_to_sd(1000000000000_u256);
    assert(amount_sd == 1_u64, 'Wrong _to_sd conversion');

    let large_amount_sd = mock.test_to_sd(1000000000000000000_u256);
    assert(large_amount_sd == 1000000_u64, 'Wrong large conversion');
}

#[test]
fn test_decimal_conversions_roundtrip() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let original_sd = 1000_u64;
    let amount_ld = mock.test_to_ld(original_sd);
    let back_to_sd = mock.test_to_sd(amount_ld);
    assert(back_to_sd == original_sd, 'Round trip failed');
}

#[test]
fn test_decimal_conversions_edge_cases() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    // Test zero
    assert(mock.test_to_ld(0_u64) == 0_u256, 'Zero conversion failed');
    assert(mock.test_to_sd(0_u256) == 0_u64, 'Zero conversion failed');

    // Test max values
    let max_sd = 0xffffffffffffffff_u64;
    let max_ld = mock.test_to_ld(max_sd);
    assert(max_ld > max_sd.into(), 'Max conversion failed');
}

#[test]
#[feature("safe_dispatcher")]
fn test_to_sd_overflow() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock_safe = IMockOFTCoreSafeDispatcher { contract_address: mock_address };

    let conversion_rate = mock_safe.test_decimal_conversion_rate().unwrap();

    let overflow_amount = 0x1_0000_0000_0000_0000 * conversion_rate;

    let result = mock_safe.test_to_sd(overflow_amount);

    assert_panic_with_error(result, err_amount_sd_overflowed(overflow_amount / conversion_rate));
}

// =============================== Dust Removal Tests =================================

#[test]
fn test_remove_dust_basic() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let cleaned_amount = mock.test_remove_dust(DUST_AMOUNT);
    assert(cleaned_amount == CLEAN_AMOUNT, 'Dust not removed');
}

#[test]
fn test_remove_dust_clean_amount() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let still_clean = mock.test_remove_dust(CLEAN_AMOUNT);
    assert(still_clean == CLEAN_AMOUNT, 'Clean amount changed');
}

#[test]
fn test_remove_dust_edge_cases() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    // Test zero
    assert(mock.test_remove_dust(0_u256) == 0_u256, 'Zero dust removal failed');

    // Test amount smaller than conversion rate
    let small_amount = 999999999999_u256; // Less than 10^12
    assert(mock.test_remove_dust(small_amount) == 0_u256, 'Small dust removal failed');
}

// =============================== Debit View Tests =================================

#[test]
fn test_debit_view_success() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let oft_debit = mock.test_debit_view(TEST_AMOUNT_LD, MIN_AMOUNT_LD, DST_EID);
    assert(oft_debit.amount_sent_ld == CLEAN_AMOUNT, 'Wrong sent amount');
    assert(oft_debit.amount_received_ld == CLEAN_AMOUNT, 'Wrong received amount');
}

#[test]
#[feature("safe_dispatcher")]
fn test_debit_view_slippage_exceeded() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };
    let mock_safe = IMockOFTCoreSafeDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let high_min_amount = TEST_AMOUNT_LD + 1_u256;

    let result = mock_safe.test_debit_view(TEST_AMOUNT_LD, high_min_amount, DST_EID);
    assert_panic_with_error(result, err_slippage_exceeded(CLEAN_AMOUNT, high_min_amount));
}

#[test]
fn test_debit_view_exact_min_amount() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_initializer(LOCAL_DECIMALS);
    stop_cheat_caller_address(mock_address);

    let oft_debit = mock.test_debit_view(TEST_AMOUNT_LD, CLEAN_AMOUNT, DST_EID);
    assert(oft_debit.amount_sent_ld == CLEAN_AMOUNT, 'Wrong sent amount');
    assert(oft_debit.amount_received_ld == CLEAN_AMOUNT, 'Wrong received amount');
}

// =============================== Msg Inspector Tests =================================

#[test]
fn test_set_msg_inspector() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft = IOFTDispatcher { contract_address: oft_address };

    let mut spy = spy_events();

    start_cheat_caller_address(oft_address, OWNER);
    oft.set_msg_inspector(OWNER);
    stop_cheat_caller_address(oft_address);

    let msg_inspector_set_event = OFTEvent::MsgInspectorSet(
        MsgInspectorSet { msg_inspector: OWNER },
    );
    spy.assert_emitted(@array![(oft_address, msg_inspector_set_event)]);

    let msg_inspector = oft.msg_inspector();
    assert(msg_inspector == OWNER, 'Msg inspector not set');
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_msg_inspector_not_owner() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft_safe = IOFTSafeDispatcher { contract_address: oft_address };

    start_cheat_caller_address(oft_address, USER);
    let result = oft_safe.set_msg_inspector(OWNER);
    stop_cheat_caller_address(oft_address);

    assert_panic_with_felt_error(result, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
fn test_build_msg_and_options() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    let mut send_param = create_test_send_param_with_extra_options();
    let result = mock.test_build_msg_and_options(send_param, TEST_AMOUNT_LD);

    assert(result.message.len() > 0, 'Message should not be empty');
    assert(result.options.len() > 0, 'Options should not be empty');
}

#[test]
#[should_panic(expected: "Invalid message or options")]
fn test_should_fail_build_msg_and_options() {
    let (mock_address, _) = deploy_mock_oft_core();
    let mock_inspector_address = deploy_mock_message_inspector();
    let mock = IMockOFTCoreDispatcher { contract_address: mock_address };

    start_cheat_caller_address(mock_address, OWNER);
    mock.test_set_msg_inspector(mock_inspector_address);
    stop_cheat_caller_address(mock_address);

    let mut send_param = create_test_send_param_with_extra_options();
    mock.test_build_msg_and_options(send_param, TEST_AMOUNT_LD);
}

// =============================== Quote Tests =================================

#[test]
fn test_quote_oft_basic() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft = IOFTDispatcher { contract_address: oft_address };

    let send_param = create_test_send_param();
    let quote = oft.quote_oft(send_param);
    let erc20 = IERC20Dispatcher { contract_address: oft_address };
    let supply = erc20.total_supply();

    assert(quote.receipt.amount_sent_ld == CLEAN_AMOUNT, 'Wrong sent amount');
    assert(quote.receipt.amount_received_ld == CLEAN_AMOUNT, 'Wrong received amount');
    assert(quote.limit.min_amount_ld == 0, 'Wrong min limit');
    assert(quote.limit.max_amount_ld == supply, 'Wrong max limit');
    assert(quote.oft_fee_details.len() == 0, 'Should have no fees');
}

#[test]
fn test_quote_oft_with_dust() {
    let (oft_address, _) = deploy_mock_oft_core();
    let oft = IOFTDispatcher { contract_address: oft_address };

    let mut send_param = create_test_send_param();
    send_param.amount_ld = DUST_AMOUNT;

    let quote = oft.quote_oft(send_param);

    assert(quote.receipt.amount_sent_ld == CLEAN_AMOUNT, 'Dust not removed');
    assert(quote.receipt.amount_received_ld == CLEAN_AMOUNT, 'Dust not removed');
}

#[test]
fn test_quote_send() {
    let (oft_address, _) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let oft = IOFTDispatcher { contract_address: oft_address };

    let expected_fee = MessagingFee { native_fee: 100, lz_token_fee: 10 };
    start_mock_call(FAKE_ENDPOINT, selector!("quote"), expected_fee.clone());

    let send_param = create_test_send_param();
    let fee = oft.quote_send(send_param, false);

    assert(fee.native_fee == 100, 'Wrong native fee');
    assert(fee.lz_token_fee == 10, 'Wrong LZ token fee');
}

#[test]
fn test_quote_send_pay_in_lz_token() {
    let (oft_address, _) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let oft = IOFTDispatcher { contract_address: oft_address };

    let expected_fee = MessagingFee { native_fee: 0, lz_token_fee: 50 };
    start_mock_call(FAKE_ENDPOINT, selector!("quote"), expected_fee.clone());

    let send_param = create_test_send_param();
    let fee = oft.quote_send(send_param, true);

    assert(fee.native_fee == 0, 'Wrong native fee');
    assert(fee.lz_token_fee == 50, 'Wrong LZ token fee');
}

// =============================== Send Tests =================================

#[test]
fn test_send_basic() {
    let (oft_address, stark_token_address) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let oft = IOFTDispatcher { contract_address: oft_address };
    let erc20 = IERC20Dispatcher { contract_address: oft_address };

    mint_tokens_to_user(oft_address, USER, TEST_AMOUNT_SD * 2);
    setup_native_fee_payment(stark_token_address, oft_address, USER, 100);

    let mock_receipt = layerzero::MessageReceipt { guid: MOCK_GUID(), nonce: 1, payees: array![] };
    start_mock_call(FAKE_ENDPOINT, selector!("send"), mock_receipt.clone());

    let initial_balance = erc20.balance_of(USER);
    assert(initial_balance >= TEST_AMOUNT_LD, 'Insufficient balance');

    let send_param = create_test_send_param();
    let fee = MessagingFee { native_fee: 100, lz_token_fee: 0 };

    start_cheat_caller_address(oft_address, USER);
    let result = oft.send(send_param, fee, REFUND_ADDRESS);
    stop_cheat_caller_address(oft_address);

    let final_balance = erc20.balance_of(USER);
    assert(final_balance == initial_balance - CLEAN_AMOUNT, 'Tokens not burned');

    assert(result.oft_receipt.amount_sent_ld == CLEAN_AMOUNT, 'Wrong sent amount');
    assert(result.oft_receipt.amount_received_ld == CLEAN_AMOUNT, 'Wrong received amount');
    assert(result.message_receipt.guid == mock_receipt.guid, 'Wrong guid');
}

#[test]
fn test_send_with_compose() {
    let (oft_address, stark_token_address) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let oft = IOFTDispatcher { contract_address: oft_address };

    mint_tokens_to_user(oft_address, USER, TEST_AMOUNT_SD * 2);
    setup_native_fee_payment(stark_token_address, oft_address, USER, 100);

    let mock_receipt = layerzero::MessageReceipt { guid: MOCK_GUID(), nonce: 1, payees: array![] };
    start_mock_call(FAKE_ENDPOINT, selector!("send"), mock_receipt.clone());

    let send_param = create_test_send_param_with_compose();
    let fee = MessagingFee { native_fee: 100, lz_token_fee: 0 };

    start_cheat_caller_address(oft_address, USER);
    let result = oft.send(send_param, fee, REFUND_ADDRESS);
    stop_cheat_caller_address(oft_address);

    assert(result.oft_receipt.amount_sent_ld == CLEAN_AMOUNT, 'Wrong sent amount');
}

// =============================== Receive Tests =================================

#[test]
fn test_lz_receive_basic() {
    let (oft_address, _) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let lz_receiver = ILayerZeroReceiverDispatcher { contract_address: oft_address };
    let erc20 = IERC20Dispatcher { contract_address: oft_address };

    let mut message: ByteArray = Default::default();
    let recipient_bytes32: Bytes32 = RECIPIENT.into();
    message.append_u256(recipient_bytes32.value);
    message.append_u64(TEST_AMOUNT_SD);

    let initial_balance = erc20.balance_of(RECIPIENT);

    start_cheat_caller_address(oft_address, FAKE_ENDPOINT);
    lz_receiver.lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);
    stop_cheat_caller_address(oft_address);

    let final_balance = erc20.balance_of(RECIPIENT);
    let expected_amount = TEST_AMOUNT_LD;
    assert(final_balance == initial_balance + expected_amount, 'Tokens not minted');
}

#[test]
fn test_lz_receive_zero_address() {
    let (oft_address, _) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let lz_receiver = ILayerZeroReceiverDispatcher { contract_address: oft_address };
    let erc20 = IERC20Dispatcher { contract_address: oft_address };

    let mut message: ByteArray = Default::default();
    message.append_u256(0); // Zero address
    message.append_u64(TEST_AMOUNT_SD);

    let initial_balance = erc20.balance_of(DEAD_ADDRESS);

    start_cheat_caller_address(oft_address, FAKE_ENDPOINT);
    lz_receiver.lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);
    stop_cheat_caller_address(oft_address);

    let final_balance = erc20.balance_of(DEAD_ADDRESS);
    assert(final_balance == initial_balance + TEST_AMOUNT_LD, 'Zero address handling failed');
}

// =============================== Integration Tests =================================

#[test]
fn test_complete_cross_chain_flow() {
    let (oft_address, stark_token_address) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let oft = IOFTDispatcher { contract_address: oft_address };
    let lz_receiver = ILayerZeroReceiverDispatcher { contract_address: oft_address };
    let erc20 = IERC20Dispatcher { contract_address: oft_address };

    // Step 1: Setup user with tokens
    mint_tokens_to_user(oft_address, USER, TEST_AMOUNT_SD * 4);
    setup_native_fee_payment(stark_token_address, oft_address, USER, 100);

    let initial_user_balance = erc20.balance_of(USER);
    let initial_recipient_balance = erc20.balance_of(RECIPIENT);

    // Step 2: Send tokens
    let mock_receipt = layerzero::MessageReceipt { guid: MOCK_GUID(), nonce: 1, payees: array![] };
    start_mock_call(FAKE_ENDPOINT, selector!("send"), mock_receipt.clone());

    let send_param = create_test_send_param();
    let fee = MessagingFee { native_fee: 100, lz_token_fee: 0 };

    start_cheat_caller_address(oft_address, USER);
    oft.send(send_param, fee, REFUND_ADDRESS);
    stop_cheat_caller_address(oft_address);

    let user_balance_after_send = erc20.balance_of(USER);
    assert(user_balance_after_send == initial_user_balance - CLEAN_AMOUNT, 'Tokens not burned');

    // Step 3: Receive tokens
    let mut message: ByteArray = Default::default();
    let recipient_bytes32: Bytes32 = RECIPIENT.into();
    message.append_u256(recipient_bytes32.value);
    message.append_u64(TEST_AMOUNT_SD);

    start_cheat_caller_address(oft_address, FAKE_ENDPOINT);
    lz_receiver.lz_receive(MOCK_ORIGIN(), MOCK_GUID(), message, USER, Default::default(), 0);
    stop_cheat_caller_address(oft_address);

    let recipient_balance_after_receive = erc20.balance_of(RECIPIENT);
    assert(
        recipient_balance_after_receive == initial_recipient_balance + TEST_AMOUNT_LD,
        'Tokens not minted',
    );
}

#[test]
fn test_send_operation_completes() {
    let (oft_address, stark_token_address) = deploy_mock_oft_core();
    setup_oft_with_peers(oft_address);
    let oft = IOFTDispatcher { contract_address: oft_address };

    mint_tokens_to_user(oft_address, USER, TEST_AMOUNT_SD * 2);
    setup_native_fee_payment(stark_token_address, oft_address, USER, 100);

    let mock_receipt = layerzero::MessageReceipt { guid: MOCK_GUID(), nonce: 1, payees: array![] };
    start_mock_call(FAKE_ENDPOINT, selector!("send"), mock_receipt.clone());

    let send_param = create_test_send_param();
    let fee = MessagingFee { native_fee: 100, lz_token_fee: 0 };

    start_cheat_caller_address(oft_address, USER);
    let result = oft.send(send_param, fee, REFUND_ADDRESS);
    stop_cheat_caller_address(oft_address);

    // Test completes successfully if no panic occurs
    assert(result.oft_receipt.amount_sent_ld > 0, 'Send operation failed');
}
