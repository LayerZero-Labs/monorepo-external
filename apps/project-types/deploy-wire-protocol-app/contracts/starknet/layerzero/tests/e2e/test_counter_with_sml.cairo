//! E2E test for Counter with SimpleMessageLib

use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::common::structs::messaging::MessagingFee;
use layerzero::common::structs::packet::{Origin, Packet};
use layerzero::endpoint::interfaces::endpoint_v2::IEndpointV2DispatcherTrait;
use layerzero::endpoint::message_lib_manager::interface::IMessageLibManagerDispatcherTrait;
use layerzero::message_lib::interface::IMessageLibDispatcherTrait;
use layerzero::message_lib::sml::simple_message_lib::SimpleMessageLib::ISimpleMessageLibHelpersDispatcherTrait;
use layerzero::oapps::counter::constants::VANILLA_TYPE;
use layerzero::oapps::counter::counter::OmniCounter;
use layerzero::oapps::counter::interface::IOmniCounterDispatcherTrait;
use layerzero::oapps::counter::structs::{IncrementReceived, IncrementSent};
use layerzero::oapps::oapp::interface::IOAppDispatcherTrait;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::{EventSpyAssertionsTrait, spy_events};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::e2e::utils::{
    SimpleMessageLibHelper, deploy_endpoint, deploy_erc20, deploy_simple_message_lib,
};
use super::utils::{ERC20Helper, EndpointV2Helper, OmniCounterHelper, deploy_omni_counter};

// Test constants
const OWNER: ContractAddress = 'owner'.try_into().unwrap();
const SENDER: ContractAddress = 'sender'.try_into().unwrap();
const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
const OAPP_OWNER: ContractAddress = 'oapp_owner'.try_into().unwrap();
const BLOCKED_LIBRARY: ContractAddress = 'blocked_library'.try_into().unwrap();

// EndpointV2 IDs
const LOCAL_EID: u32 = 1;
const REMOTE_EID: u32 = 2;

// Token amounts
const INITIAL_SUPPLY: u256 = 1000000; // 1M tokens

// Test values
const SENDER_FUNDING_AMOUNT: u256 = 10000;
const TEST_NONCE: u64 = 1;
const TEST_GUID_VALUE: u256 = 0x123456789abcdef;
const EXECUTE_VALUE: u256 = 100;

struct TestSetup {
    native_token: ERC20Helper,
    endpoint: EndpointV2Helper,
    sml: SimpleMessageLibHelper,
    counter: OmniCounterHelper,
}

fn setup() -> TestSetup {
    let native_token = deploy_erc20(INITIAL_SUPPLY, OWNER);
    let endpoint = deploy_endpoint(OWNER, LOCAL_EID, native_token.address);
    let sml = deploy_simple_message_lib(endpoint.address);
    let counter = deploy_omni_counter(endpoint.address, OAPP_OWNER, native_token.address);

    // Register SimpleMessageLib
    // Satisfy registration-time type check
    cheat_caller_address_once(endpoint.address, OWNER);
    endpoint.message_lib_manager.register_library(sml.address);

    // Set delegate for endpoint
    cheat_caller_address_once(counter.address, OAPP_OWNER);
    counter.oapp.set_delegate(OAPP_OWNER);

    TestSetup { native_token, endpoint, sml, counter }
}

#[test]
fn test_send_message_with_sml() {
    // This test simulates the following scenario:
    // OApp OWNER sets the send library for the counter
    // OApp OWNER sets the peer for the counter
    // SENDER has tokens to send
    // SENDER sends an increment message to the counter
    // EndpointV2 confirms the message

    let TestSetup { native_token, endpoint, sml, counter, .. } = setup();

    // OWNER gives tokens to SENDER
    cheat_caller_address_once(native_token.address, OWNER);
    native_token.erc20.transfer(SENDER, SENDER_FUNDING_AMOUNT);

    // Set send library and peer for counter
    cheat_caller_address_once(endpoint.address, OAPP_OWNER);
    endpoint.message_lib_manager.set_send_library(counter.address, REMOTE_EID, sml.address);

    cheat_caller_address_once(counter.address, OAPP_OWNER);
    counter.oapp.set_peer(REMOTE_EID, counter.address.into());

    cheat_caller_address_once(native_token.address, SENDER);
    native_token.erc20.approve(counter.address, SENDER_FUNDING_AMOUNT);

    // Start spying on events
    let mut spy = spy_events();

    // Send increment message
    let fee = MessagingFee { native_fee: SENDER_FUNDING_AMOUNT, lz_token_fee: 0 };

    cheat_caller_address_once(counter.address, SENDER);
    let receipt = counter
        .omni_counter
        .increment(REMOTE_EID, VANILLA_TYPE, "test options", fee, SENDER);

    // Verify receipt
    assert(receipt.nonce == 1, 'First nonce should be 1');

    spy
        .assert_emitted(
            @array![
                (
                    counter.address,
                    OmniCounter::Event::IncrementSent(
                        IncrementSent {
                            sender: SENDER, dst_eid: REMOTE_EID, increment_type: VANILLA_TYPE,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_receive_message_with_sml() {
    let TestSetup { native_token, endpoint, sml, counter } = setup();

    // Set receive library and peer for counter
    cheat_caller_address_once(endpoint.address, OAPP_OWNER);
    endpoint.message_lib_manager.set_receive_library(counter.address, REMOTE_EID, sml.address, 0);

    cheat_caller_address_once(counter.address, OAPP_OWNER);
    counter.oapp.set_peer(REMOTE_EID, SENDER.into());

    // Start spying on events
    let mut spy = spy_events();

    // Create a packet for the message
    let nonce = TEST_NONCE;
    let guid = Bytes32 { value: TEST_GUID_VALUE };
    let mut message: ByteArray = "";
    message.append_byte(VANILLA_TYPE);
    message.append_u32(REMOTE_EID);

    let packet = Packet {
        nonce,
        src_eid: REMOTE_EID,
        sender: SENDER,
        dst_eid: LOCAL_EID,
        receiver: counter.address.into(),
        guid,
        message: message.clone(),
    };

    // Encode the packet to get header and payload hash
    let encoded_packet = PacketV1Codec::encode(@packet);
    let packet_header = PacketV1Codec::header(@encoded_packet);
    let payload_hash = PacketV1Codec::payload_hash(@encoded_packet);

    // OWNER gives tokens to EXECUTOR
    cheat_caller_address_once(native_token.address, OWNER);
    native_token.erc20.transfer(EXECUTOR, SENDER_FUNDING_AMOUNT);

    // Executor calls commit on message library
    sml.simple_message_lib_helpers.set_whitelist_caller(EXECUTOR);
    cheat_caller_address_once(sml.address, EXECUTOR);
    sml.message_lib.commit(packet_header, payload_hash);

    // Create origin for lz_receive
    let origin = Origin { src_eid: REMOTE_EID, sender: SENDER.into(), nonce };
    let value = EXECUTE_VALUE;

    // As executor give value as allowance to endpoint
    cheat_caller_address_once(native_token.address, EXECUTOR);
    native_token.erc20.approve(endpoint.address, value);

    // Executor calls lz_receive on endpoint
    cheat_caller_address_once(endpoint.address, EXECUTOR);
    endpoint.endpoint.lz_receive(origin, counter.address, guid, message, "", value);

    // Verify counter was incremented
    assert(counter.omni_counter.get_counter(REMOTE_EID) == 1, 'Counter not incremented');

    // Verify IncrementReceived event
    let expected_increment_received = OmniCounter::Event::IncrementReceived(
        IncrementReceived {
            src_eid: REMOTE_EID, old_value: 0, new_value: 1, increment_type: VANILLA_TYPE, value,
        },
    );
    spy.assert_emitted(@array![(counter.address, expected_increment_received)]);
}
