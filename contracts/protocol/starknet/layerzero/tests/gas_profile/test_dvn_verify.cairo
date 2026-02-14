use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::message_lib::uln_302::structs::executor_config::ExecutorConfig;
use layerzero::workers::dvn::interface::IDvnDispatcherTrait;
use layerzero::workers::dvn::structs::ExecuteParam;
use lz_utils::bytes::ContractAddressIntoBytes32;
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::e2e::utils::{
    deploy_dvn, deploy_endpoint, deploy_price_feed, deploy_treasury, deploy_ultra_light_node_302,
    wire_ultra_light_node_302,
};
use crate::gas_profile::utils::{
    DVN_ADMIN, DVN_CALL_DATA_EXPIRATION, DVN_DST_CONFIG, DVN_OWNER, ENDPOINT_OWNER, LOCAL_EID,
    MAX_MESSAGE_SIZE, MESSAGE_LIB_OWNER, PRICE_FEED_OWNER, REMOTE_EID, TREASURY_OWNER,
    build_dvn_signers, build_dvn_verification_call_data, build_incoming_packet, create_uln_config,
    get_native_token,
};
use crate::workers::dvn::utils::build_signatures;

const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
const DVN_VID: u32 = 0;
const LOCAL_OAPP: ContractAddress = 'local_oapp'.try_into().unwrap();

#[test]
fn test_verify() {
    let native_token = get_native_token();
    let endpoint = deploy_endpoint(ENDPOINT_OWNER, LOCAL_EID, native_token.address);
    let treasury = deploy_treasury(TREASURY_OWNER, 0);
    let message_lib = deploy_ultra_light_node_302(
        MESSAGE_LIB_OWNER, treasury.address, endpoint.address, 0,
    );
    let price_feed = deploy_price_feed(PRICE_FEED_OWNER, REMOTE_EID);
    let signers = build_dvn_signers();
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
        ExecutorConfig { executor: EXECUTOR, max_message_size: MAX_MESSAGE_SIZE },
    );

    let packet = PacketV1Codec::encode(@build_incoming_packet(LOCAL_OAPP, ""));
    let call_data = build_dvn_verification_call_data(message_lib.address, @packet);
    let hash = dvn.dvn.hash_call_data(dvn.dvn.get_vid(), call_data, DVN_CALL_DATA_EXPIRATION);
    let signatures = build_signatures(signers.span(), hash);

    cheat_caller_address_once(dvn.address, DVN_ADMIN);
    dvn
        .dvn
        .execute(
            array![
                ExecuteParam {
                    vid: DVN_VID,
                    call_data,
                    expiration: DVN_CALL_DATA_EXPIRATION,
                    signatures: signatures.span(),
                },
            ],
        );
}
