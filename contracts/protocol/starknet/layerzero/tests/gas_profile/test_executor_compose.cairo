use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::message_lib_manager::interface::IMessageLibManagerDispatcherTrait;
use layerzero::endpoint::messaging_composer::events::ComposeDelivered;
use layerzero::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent;
use layerzero::message_lib::interface::IMessageLibDispatcherTrait;
use layerzero::message_lib::uln_302::structs::executor_config::ExecutorConfig;
use layerzero::workers::dvn::interface::IDvnDispatcherTrait;
use layerzero::workers::dvn::structs::ExecuteParam;
use layerzero::workers::executor::interface::IExecutorDispatcherTrait;
use layerzero::workers::executor::structs::{ComposeParams, ExecuteParams};
use lz_utils::bytes::ContractAddressIntoBytes32;
use snforge_std::{EventSpyAssertionsTrait, Token, set_balance, spy_events};
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::constants::SENT_COMPOSE_MESSAGE_SIZE_LIMIT;
use crate::e2e::utils::{
    deploy_dvn, deploy_endpoint, deploy_executor, deploy_price_feed, deploy_treasury,
    deploy_ultra_light_node_302, wire_ultra_light_node_302,
};
use crate::gas_profile::utils::{
    DVN_ADMIN, DVN_CALL_DATA_EXPIRATION, DVN_DST_CONFIG, DVN_OWNER, ENDPOINT_OWNER, EXECUTOR_ADMIN,
    EXECUTOR_DST_CONFIG, EXECUTOR_ROLE_ADMIN, LOCAL_EID, MAX_MESSAGE_SIZE, MESSAGE_LIB_OWNER,
    PRICE_FEED_OWNER, REMOTE_EID, TREASURY_OWNER, build_byte_array, build_dvn_signers,
    build_dvn_verification_call_data, build_incoming_packet, create_uln_config, deploy_compose_oapp,
    deploy_composer_target, get_native_token,
};
use crate::workers::dvn::utils::build_signatures;

const TOTAL_STEPS: usize = 5;

const DVN_VID: u32 = 0;
const VALUE: u256 = 42; // a non-zero value to trigger a transfer

fn compose(step: usize) {
    let native_token = get_native_token();
    let endpoint = deploy_endpoint(ENDPOINT_OWNER, LOCAL_EID, native_token.address);
    let treasury = deploy_treasury(TREASURY_OWNER, 0);
    let message_lib = deploy_ultra_light_node_302(
        MESSAGE_LIB_OWNER, treasury.address, endpoint.address, 0,
    );
    let price_feed = deploy_price_feed(PRICE_FEED_OWNER, REMOTE_EID);
    let signers = build_dvn_signers();
    let executor = deploy_executor(
        endpoint.address,
        message_lib.address,
        price_feed,
        EXECUTOR_ROLE_ADMIN,
        array![EXECUTOR_ADMIN],
        native_token.address,
        EXECUTOR_DST_CONFIG,
        REMOTE_EID,
    );
    let dvn = deploy_dvn(
        message_lib.address,
        price_feed,
        DVN_VID,
        @signers,
        array![DVN_ADMIN].span(),
        DVN_OWNER,
        DVN_DST_CONFIG,
        REMOTE_EID,
    );

    wire_ultra_light_node_302(
        MESSAGE_LIB_OWNER,
        @message_lib,
        REMOTE_EID,
        create_uln_config(array![dvn.address]),
        ExecutorConfig { executor: executor.address, max_message_size: MAX_MESSAGE_SIZE },
    );

    cheat_caller_address_once(endpoint.address, ENDPOINT_OWNER);
    endpoint.message_lib_manager.register_library(message_lib.address);
    cheat_caller_address_once(endpoint.address, ENDPOINT_OWNER);
    endpoint.message_lib_manager.set_default_receive_library(REMOTE_EID, message_lib.address, 0);

    let compose_message = build_byte_array(
        SENT_COMPOSE_MESSAGE_SIZE_LIMIT / 2 * step / TOTAL_STEPS,
    );
    let composer_target = deploy_composer_target();
    let oapp = deploy_compose_oapp(composer_target, compose_message.clone());

    let packet = build_incoming_packet(oapp, "");
    let encoded_packet = PacketV1Codec::encode(@packet);
    let call_data = build_dvn_verification_call_data(message_lib.address, @encoded_packet);
    let vid = dvn.dvn.get_vid();
    let hash = dvn.dvn.hash_call_data(vid, call_data, DVN_CALL_DATA_EXPIRATION);

    cheat_caller_address_once(dvn.address, DVN_ADMIN);
    dvn
        .dvn
        .execute(
            array![
                ExecuteParam {
                    vid,
                    call_data,
                    expiration: DVN_CALL_DATA_EXPIRATION,
                    signatures: build_signatures(signers.span(), hash).span(),
                },
            ],
        );

    message_lib
        .message_lib
        .commit(
            PacketV1Codec::header(@encoded_packet), PacketV1Codec::payload_hash(@encoded_packet),
        );

    let origin = Origin {
        src_eid: packet.src_eid, sender: packet.sender.into(), nonce: packet.nonce,
    };

    cheat_caller_address_once(executor.address, EXECUTOR_ADMIN);
    executor
        .executor
        .execute(
            ExecuteParams {
                receiver: packet.receiver.try_into().unwrap(),
                origin: origin.clone(),
                guid: packet.guid,
                message: packet.message,
                gas_limit: EXECUTOR_DST_CONFIG.lz_receive_base_gas.try_into().unwrap(),
                value: 0,
                extra_data: "",
            },
        );

    set_balance(executor.address, VALUE, Token::STRK);

    let mut spy = spy_events();

    cheat_caller_address_once(executor.address, EXECUTOR_ADMIN);
    executor
        .executor
        .compose(
            ComposeParams {
                receiver: composer_target,
                sender: oapp,
                guid: packet.guid,
                index: 0,
                value: VALUE,
                message: compose_message,
                extra_data: "",
                gas_limit: EXECUTOR_DST_CONFIG.lz_compose_base_gas.try_into().unwrap(),
            },
        );

    // We check a compose event explicitly because the `compose` call on the executor
    // always "succeeds" when it reaches the `lz_compose` call on the endpoint.
    spy
        .assert_emitted(
            @array![
                (
                    endpoint.address,
                    MessagingComposerComponent::Event::ComposeDelivered(
                        ComposeDelivered {
                            from: oapp, to: composer_target, guid: packet.guid, index: 0,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_compose_0() {
    compose(0);
}

#[test]
fn test_compose_1() {
    compose(1);
}

#[test]
fn test_compose_2() {
    compose(2);
}

#[test]
fn test_compose_3() {
    compose(3);
}

#[test]
fn test_compose_4() {
    compose(4);
}

#[test]
fn test_compose_5() {
    compose(TOTAL_STEPS);
}
