use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::endpoint_v2::IEndpointV2DispatcherTrait;
use layerzero::endpoint::messaging_composer::interface::IMessagingComposerDispatcherTrait;
use lz_utils::bytes::ContractAddressIntoBytes32;
use starknet::ContractAddress;
use crate::constants::{ALERT_COMPOSE_MESSAGE_SIZE_LIMIT, ALERT_MESSAGE_SIZE_LIMIT};
use crate::e2e::utils::deploy_endpoint;
use crate::gas_profile::utils::{ENDPOINT_OWNER, LOCAL_EID, get_native_token};
use super::utils::{build_alert_reason, build_byte_array, build_incoming_packet};

const LOCAL_OAPP: ContractAddress = 'local_oapp'.try_into().unwrap();
const LOCAL_COMPOSER: ContractAddress = 'local_composer'.try_into().unwrap();

const TOTAL_STEPS: usize = 5;

fn lz_receive_alert(step: usize) {
    let native_token = get_native_token();
    let endpoint = deploy_endpoint(ENDPOINT_OWNER, LOCAL_EID, native_token.address);
    let packet = build_incoming_packet(
        LOCAL_OAPP, build_byte_array(ALERT_MESSAGE_SIZE_LIMIT / 2 * step / TOTAL_STEPS),
    );

    endpoint
        .endpoint
        .lz_receive_alert(
            Origin { src_eid: packet.src_eid, sender: packet.sender.into(), nonce: packet.nonce },
            packet.receiver.try_into().unwrap(),
            packet.guid,
            0,
            0,
            packet.message,
            "",
            build_alert_reason(),
        );
}

#[test]
fn test_lz_receive_alert_0() {
    lz_receive_alert(0);
}

#[test]
fn test_lz_receive_alert_1() {
    lz_receive_alert(1);
}

#[test]
fn test_lz_receive_alert_2() {
    lz_receive_alert(2);
}

#[test]
fn test_lz_receive_alert_3() {
    lz_receive_alert(3);
}

#[test]
fn test_lz_receive_alert_4() {
    lz_receive_alert(4);
}

#[test]
fn test_lz_receive_alert_5() {
    lz_receive_alert(TOTAL_STEPS);
}

fn lz_compose_alert(step: usize) {
    let native_token = get_native_token();
    let endpoint = deploy_endpoint(ENDPOINT_OWNER, LOCAL_EID, native_token.address);
    let packet = build_incoming_packet(LOCAL_OAPP, "");

    endpoint
        .messaging_composer
        .lz_compose_alert(
            packet.receiver.try_into().unwrap(),
            LOCAL_COMPOSER,
            packet.guid,
            0,
            0,
            0,
            build_byte_array(ALERT_COMPOSE_MESSAGE_SIZE_LIMIT / 2 * step / TOTAL_STEPS),
            "",
            build_alert_reason(),
        );
}

#[test]
fn test_lz_compose_alert_0() {
    lz_compose_alert(0);
}

#[test]
fn test_lz_compose_alert_1() {
    lz_compose_alert(1);
}

#[test]
fn test_lz_compose_alert_2() {
    lz_compose_alert(2);
}

#[test]
fn test_lz_compose_alert_3() {
    lz_compose_alert(3);
}

#[test]
fn test_lz_compose_alert_4() {
    lz_compose_alert(4);
}

#[test]
fn test_lz_compose_alert_5() {
    lz_compose_alert(TOTAL_STEPS);
}
