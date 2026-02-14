//! EndpointV2 quote tests

use layerzero::common::structs::messaging::MessagingParams;
use layerzero::endpoint::errors;
use layerzero::endpoint::interfaces::endpoint_v2::{
    IEndpointV2DispatcherTrait, IEndpointV2SafeDispatcherTrait,
};
use layerzero::endpoint::message_lib_manager::errors as msg_lib_mgr_errors;
use layerzero::endpoint::message_lib_manager::interface::{
    IMessageLibManagerDispatcher, IMessageLibManagerDispatcherTrait,
};
use layerzero::message_lib::structs::MessageLibType;
use lz_utils::bytes::ContractAddressIntoBytes32;
use snforge_std::{start_cheat_caller_address, start_mock_call, stop_cheat_caller_address};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::assert_panic_with_error;
use crate::endpoint::utils::{EndpointV2Deploy, deploy_endpoint, deploy_simple_message_lib};

const EID: u32 = 1;
const OWNER: ContractAddress = 'owner'.try_into().unwrap();
const MESSAGE_LIB: ContractAddress = 'message_lib'.try_into().unwrap();
const MOCK_SEND_LIB: ContractAddress = 'mock_send_lib'.try_into().unwrap();
const MOCK_NONCE: u64 = 1;

///////////////////
// Success cases //
///////////////////

#[test]
fn endpoint_quote_succeeds_valid() {
    let EndpointV2Deploy { endpoint, dispatcher, .. } = deploy_endpoint(OWNER, EID);
    let msg_lib = deploy_simple_message_lib(endpoint);
    let msg_lib_manager = IMessageLibManagerDispatcher { contract_address: endpoint };

    // Register & set the send library
    // Caller is the endpoint owner
    start_cheat_caller_address(endpoint, OWNER);
    // Satisfy registration-time type check
    start_mock_call(msg_lib, selector!("message_lib_type"), MessageLibType::SendAndReceive);
    msg_lib_manager.register_library(msg_lib);
    msg_lib_manager.set_send_library(OWNER, EID, msg_lib);
    stop_cheat_caller_address(endpoint);

    let params = MessagingParams { pay_in_lz_token: false, dst_eid: EID, ..Default::default() };

    dispatcher.quote(params, OWNER);
}

///////////////////
// Failure cases //
///////////////////

#[test]
#[feature("safe_dispatcher")]
fn endpoint_quote_fails_if_send_library_is_not_set() {
    let EndpointV2Deploy { safe_dispatcher, .. } = deploy_endpoint(OWNER, EID);
    let params = MessagingParams { pay_in_lz_token: false, dst_eid: EID, ..Default::default() };

    let res = safe_dispatcher.quote(params, OWNER);
    assert_panic_with_error(res, msg_lib_mgr_errors::err_default_send_lib_unavailable());
}

#[test]
#[feature("safe_dispatcher")]
fn endpoint_quote_fails_if_pay_in_lz_token_and_lz_token_unavailable() {
    let EndpointV2Deploy { safe_dispatcher, .. } = deploy_endpoint(OWNER, EID);
    let params = MessagingParams { pay_in_lz_token: true, dst_eid: EID, ..Default::default() };

    let res = safe_dispatcher.quote(params, OWNER);
    assert_panic_with_error(res, errors::err_lz_token_unavailable());
}
