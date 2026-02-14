//! Simple message library tests

use layerzero::Packet;
use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::message_lib::interface::{
    IMessageLibDispatcher, IMessageLibDispatcherTrait, IMessageLibSafeDispatcher,
    IMessageLibSafeDispatcherTrait,
};
use layerzero::message_lib::sml::errors::err_only_whitelist_caller;
use layerzero::message_lib::sml::events::{PacketSent, PacketVerified};
use layerzero::message_lib::sml::simple_message_lib::SimpleMessageLib;
use layerzero::message_lib::sml::simple_message_lib::SimpleMessageLib::{
    ISimpleMessageLibHelpersDispatcher, ISimpleMessageLibHelpersDispatcherTrait,
};
use lz_utils::bytes::Bytes32;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::constants::assert_eq;
use crate::endpoint::utils::{EndpointV2Mock, deploy_mock_endpoint};
use crate::fuzzable::bytes32::FuzzableBytes32;
use crate::fuzzable::contract_address::{FuzzableContractAddress, FuzzableContractAddresses};
use crate::fuzzable::eid::{Eid, FuzzableEid};

const SRC_EID: u32 = 1;
const DST_EID: u32 = 2;

fn create_mock_packet() -> Packet {
    Packet {
        nonce: 1,
        src_eid: SRC_EID,
        sender: 'sender'.try_into().unwrap(),
        dst_eid: DST_EID,
        receiver: Bytes32 { value: 'receiver'.into() },
        guid: Bytes32 { value: 'guid'.into() },
        message: "message",
    }
}

fn deploy_mock_simple_message_library(
    endpoint: ContractAddress,
) -> (IMessageLibDispatcher, IMessageLibSafeDispatcher, ISimpleMessageLibHelpersDispatcher) {
    let contract = declare("SimpleMessageLib").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![endpoint.into()]).unwrap_syscall();

    (
        IMessageLibDispatcher { contract_address },
        IMessageLibSafeDispatcher { contract_address },
        ISimpleMessageLibHelpersDispatcher { contract_address },
    )
}

#[test]
#[fuzzer(runs: 10)]
fn test_mock_constructor(endpoint: ContractAddress) {
    deploy_mock_simple_message_library(endpoint);
}

#[test]
#[fuzzer(runs: 10)]
fn test_send_paying_native_payees(endpoint: ContractAddress, native_fee: u256) {
    let (dispatcher, _, helper_dispatcher) = deploy_mock_simple_message_library(endpoint);

    helper_dispatcher.set_use_mock_payees();
    helper_dispatcher.set_native_fee(native_fee);

    let result = dispatcher.send(create_mock_packet(), "", false);
    let payees = result.message_receipt.payees;

    assert_eq(payees.len(), 2);
    assert_eq(*payees[0].native_amount, native_fee / 2);
    assert_eq(*payees[0].lz_token_amount, 0);
    assert_eq(*payees[1].native_amount, native_fee - native_fee / 2);
    assert_eq(*payees[1].lz_token_amount, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_send_paying_lz_token_payees(endpoint: ContractAddress, lz_token_fee: u256) {
    let (dispatcher, _, helper_dispatcher) = deploy_mock_simple_message_library(endpoint);

    helper_dispatcher.set_use_mock_lz_payees();
    helper_dispatcher.set_lz_token_fee(lz_token_fee);

    let result = dispatcher.send(create_mock_packet(), "", true);
    let payees = result.message_receipt.payees;

    assert_eq(payees.len(), 2);
    assert_eq(*payees[0].native_amount, 0);
    assert_eq(*payees[0].lz_token_amount, lz_token_fee / 2);
    assert_eq(*payees[1].native_amount, 0);
    assert_eq(*payees[1].lz_token_amount, lz_token_fee - lz_token_fee / 2);
}

#[test]
#[fuzzer(runs: 10)]
fn test_send_paying_mixed_payees(endpoint: ContractAddress, native_fee: u256, lz_token_fee: u256) {
    let (dispatcher, _, helper_dispatcher) = deploy_mock_simple_message_library(endpoint);

    helper_dispatcher.set_use_mock_mixed_payees();
    helper_dispatcher.set_native_fee(native_fee);
    helper_dispatcher.set_lz_token_fee(lz_token_fee);

    let result = dispatcher.send(create_mock_packet(), "", true);
    let payees = result.message_receipt.payees;

    assert_eq(payees.len(), 2);
    assert_eq(*payees[0].native_amount, native_fee);
    assert_eq(*payees[0].lz_token_amount, 0);
    assert_eq(*payees[1].native_amount, 0);
    assert_eq(*payees[1].lz_token_amount, lz_token_fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_send_event(endpoint: ContractAddress, native_fee: u256) {
    let (dispatcher, _, helper_dispatcher) = deploy_mock_simple_message_library(endpoint);

    helper_dispatcher.set_use_mock_payees();
    helper_dispatcher.set_native_fee(native_fee);

    let mut spy = spy_events();

    let packet = create_mock_packet();
    dispatcher.send(packet.clone(), "", false);

    spy
        .assert_emitted(
            @array![
                (
                    dispatcher.contract_address,
                    SimpleMessageLib::Event::PacketSent(
                        PacketSent {
                            nonce: packet.nonce,
                            src_eid: packet.src_eid,
                            sender: packet.sender,
                            dst_eid: packet.dst_eid,
                            receiver: packet.receiver,
                            guid: packet.guid,
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_verify_event(endpoint: ContractAddress, payload_hash: Bytes32, confirmations: u64) {
    let (dispatcher, _, _) = deploy_mock_simple_message_library(endpoint);

    let mut spy = spy_events();

    let packet = create_mock_packet();

    dispatcher.verify(PacketV1Codec::encode_header(@packet), payload_hash, confirmations);

    spy
        .assert_emitted(
            @array![
                (
                    dispatcher.contract_address,
                    SimpleMessageLib::Event::PacketVerified(
                        PacketVerified {
                            nonce: packet.nonce,
                            src_eid: packet.src_eid,
                            sender: packet.sender.into(),
                            dst_eid: packet.dst_eid,
                            receiver: packet.receiver.try_into().unwrap(),
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_commit_with_whitelist_caller(
    endpoint_owner: ContractAddress, eid: Eid, executor: ContractAddress, payload_hash: Bytes32,
) {
    let EndpointV2Mock { endpoint, .. } = deploy_mock_endpoint(endpoint_owner, eid.eid);
    let (dispatcher, _, helper_dispatcher) = deploy_mock_simple_message_library(endpoint);

    helper_dispatcher.set_whitelist_caller(executor);
    cheat_caller_address_once(dispatcher.contract_address, executor);
    dispatcher.commit(PacketV1Codec::encode_header(@create_mock_packet()), payload_hash);
}

#[test]
#[fuzzer(runs: 10)]
fn test_commit_with_non_whitelist_caller(endpoint: ContractAddress, payload_hash: Bytes32) {
    let (_, safe_dispatcher, _) = deploy_mock_simple_message_library(endpoint);

    let result = safe_dispatcher
        .commit(PacketV1Codec::encode_header(@create_mock_packet()), payload_hash);

    assert_panic_with_error(result, err_only_whitelist_caller());
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_native_fee(endpoint: ContractAddress, fee: u256) {
    let (_, _, helper_dispatcher) = deploy_mock_simple_message_library(endpoint);

    assert_eq(helper_dispatcher.get_native_fee(), 1000);

    helper_dispatcher.set_native_fee(fee);

    assert_eq(helper_dispatcher.get_native_fee(), fee);
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_lz_token_fee(endpoint: ContractAddress, fee: u256) {
    let (_, _, helper_dispatcher) = deploy_mock_simple_message_library(endpoint);

    assert_eq(helper_dispatcher.get_lz_token_fee(), 999);

    helper_dispatcher.set_lz_token_fee(fee);

    assert_eq(helper_dispatcher.get_lz_token_fee(), fee);
}
