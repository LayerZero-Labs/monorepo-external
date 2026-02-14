//! E2E test to send and receive OFTs with SimpleMessageLib

use core::num::traits::Bounded;
use layerzero::common::guid::GUID;
use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::common::structs::packet::{Origin, Packet};
use layerzero::endpoint;
use layerzero::endpoint::endpoint_v2::EndpointV2;
use layerzero::endpoint::interfaces::endpoint_v2::IEndpointV2DispatcherTrait;
use layerzero::endpoint::message_lib_manager::interface::IMessageLibManagerDispatcherTrait;
use layerzero::message_lib::interface::IMessageLibDispatcherTrait;
use layerzero::message_lib::sml;
use layerzero::message_lib::sml::simple_message_lib::SimpleMessageLib;
use layerzero::oapps::oapp::interface::IOAppDispatcherTrait;
use layerzero::oapps::oft::interface::IOFTDispatcherTrait;
use layerzero::oapps::oft::oft_msg_codec::OFTMsgCodec;
use layerzero::oapps::oft::structs::SendParam;
use lz_utils::bytes::ContractAddressIntoBytes32;
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use sml::simple_message_lib::SimpleMessageLib::ISimpleMessageLibHelpersDispatcherTrait;
use snforge_std::{EventSpyAssertionsTrait, spy_events};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::constants::assert_eq;
use crate::e2e::oft_utils::{DIFF_DECIMALS, OFTHelper, deploy_oft, mint_tokens};
use crate::e2e::utils::{ERC20Helper, EndpointV2Helper, deploy_endpoint, deploy_erc20};
use crate::fuzzable::blockchain_config::BlockchainConfig;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::FuzzableEid;
use crate::mocks::erc20::interface::IMockERC20DispatcherTrait;
use super::utils::{SimpleMessageLibHelper, deploy_simple_message_lib, wire_oapp};

#[derive(Drop)]
struct ContractSet {
    native_token: ERC20Helper,
    endpoint: EndpointV2Helper,
    message_lib: SimpleMessageLibHelper,
    oft: OFTHelper,
}

fn setup_blockchain(config: @BlockchainConfig) -> ContractSet {
    let native_token = deploy_erc20(*config.native_token_supply, *config.native_token_owner);
    let endpoint = deploy_endpoint(*config.endpoint_owner, *config.eid.eid, native_token.address);
    let message_lib = deploy_simple_message_lib(endpoint.address);

    cheat_caller_address_once(endpoint.address, *config.endpoint_owner);
    endpoint.message_lib_manager.register_library(message_lib.address);

    let oft = deploy_oft(
        config.oft_name,
        config.oft_symbol,
        endpoint.address,
        *config.oapp_owner,
        native_token.address,
    );
    cheat_caller_address_once(oft.address, *config.oapp_owner);
    oft.oapp.set_delegate(*config.oapp_owner);

    ContractSet { native_token, endpoint, message_lib, oft }
}

// We test the scenario where we send a message from a blockchain and receive it on another
// blockchain. While this is implemented on a single Starknet blockchain, we deploy duplicate
// endpoints, OFT OApps, etc. and transfer messages among them in order to simulate the omnichain
// communication.
#[test]
#[fuzzer(runs: 10)]
fn test_transfer_tokens(
    src_config: BlockchainConfig,
    dst_config: BlockchainConfig,
    dst_executor: ContractAddress,
    amount_seed: u256,
) {
    let src = setup_blockchain(@src_config);
    let dst = setup_blockchain(@dst_config);

    // =============================== Transfer parameters =================================

    let amount_ld = amount_seed % (Bounded::<u64>::MAX.into() * DIFF_DECIMALS);
    let amount_sd: u64 = (amount_ld / DIFF_DECIMALS).try_into().unwrap();
    let dust_ld = amount_ld % DIFF_DECIMALS;
    let clean_amount_ld = amount_ld - dust_ld;
    // Expect a lossless token transfer.
    let min_amount_ld = amount_sd.into() * DIFF_DECIMALS;

    // Preconditions
    assert_eq(clean_amount_ld, min_amount_ld);
    assert(amount_sd > 0, 'Greater than 0'); // Hopefully, we never hit 0 of `u64`...

    // =============================== Wiring =================================

    wire_oapp(
        @src.endpoint,
        src.message_lib.address,
        src.oft.oapp,
        src_config.oapp_owner,
        dst_config.eid.eid,
        dst.oft.address,
    );

    wire_oapp(
        @dst.endpoint,
        dst.message_lib.address,
        dst.oft.oapp,
        dst_config.oapp_owner,
        src_config.eid.eid,
        src.oft.address,
    );

    // =============================== Send tokens =================================

    const REMAINDER_SD: u64 = 1;
    let balance_sd = amount_sd + REMAINDER_SD;
    mint_tokens(
        src.oft.address,
        src_config.user,
        balance_sd,
        src.endpoint.address,
        Origin { src_eid: dst_config.eid.eid, sender: dst.oft.address.into(), nonce: 1 },
    );

    assert_eq(src.oft.erc20.balance_of(src_config.user), balance_sd.into() * DIFF_DECIMALS);

    let send_param = SendParam {
        dst_eid: dst_config.eid.eid,
        to: dst_config.user.into(),
        amount_ld,
        min_amount_ld,
        extra_options: "",
        compose_msg: "",
        oft_cmd: "",
    };
    let quote = src.oft.oft.quote_oft(send_param.clone());

    assert_eq(quote.receipt.amount_sent_ld, clean_amount_ld);
    assert_eq(quote.receipt.amount_received_ld, clean_amount_ld);
    assert_eq(quote.limit.min_amount_ld, 0);
    assert_eq(quote.limit.max_amount_ld, src.oft.erc20.total_supply());
    assert_eq(quote.oft_fee_details.len(), 0);

    let fee = src.oft.oft.quote_send(send_param.clone(), false);

    assert(fee.native_fee > 0, 'Greater than 0');
    assert_eq(fee.lz_token_fee, 0);

    cheat_caller_address_once(src.native_token.address, src_config.native_token_owner);
    src.native_token.mock_erc20.mint(src_config.user, fee.native_fee);

    assert_eq(src.native_token.erc20.balance_of(src_config.user), fee.native_fee);

    cheat_caller_address_once(src.native_token.address, src_config.user);
    src.native_token.erc20.approve(src.oft.address, fee.native_fee);

    let mut spy = spy_events();

    cheat_caller_address_once(src.oft.address, src_config.user);
    let result = src.oft.oft.send(send_param, fee, src_config.user);

    assert_eq(result.oft_receipt.amount_sent_ld, clean_amount_ld);
    assert_eq(result.oft_receipt.amount_received_ld, clean_amount_ld);
    assert_eq(src.native_token.erc20.balance_of(src_config.user), 0);
    assert_eq(src.oft.erc20.balance_of(src_config.user), REMAINDER_SD.into() * DIFF_DECIMALS);

    // =============================== Worker emulation =================================

    let (message, has_compose) = OFTMsgCodec::encode(dst_config.user.into(), amount_sd, @"");
    assert(!has_compose, 'Not compose');
    let guid = GUID::generate(
        1, src_config.eid.eid, src.oft.address.into(), dst_config.eid.eid, dst.oft.address.into(),
    );
    let packet = Packet {
        nonce: 1,
        src_eid: src_config.eid.eid,
        sender: src.oft.address,
        dst_eid: dst_config.eid.eid,
        receiver: dst.oft.address.into(),
        guid,
        message: message.clone(),
    };

    spy
        .assert_emitted(
            @array![
                (
                    src.message_lib.address,
                    SimpleMessageLib::Event::PacketSent(
                        sml::events::PacketSent {
                            nonce: 1,
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

    spy
        .assert_emitted(
            @array![
                (
                    src.endpoint.address,
                    EndpointV2::Event::PacketSent(
                        endpoint::events::PacketSent {
                            encoded_packet: "mock_encoded_packet_data",
                            options: "",
                            send_library: src.message_lib.address,
                        },
                    ),
                ),
            ],
        );

    // =============================== Receive tokens =================================

    let packet = PacketV1Codec::encode(@packet);

    dst.message_lib.simple_message_lib_helpers.set_whitelist_caller(dst_executor);
    cheat_caller_address_once(dst.message_lib.address, dst_executor);
    dst
        .message_lib
        .message_lib
        .commit(PacketV1Codec::header(@packet), PacketV1Codec::payload_hash(@packet));

    assert_eq(dst.native_token.erc20.balance_of(dst_config.user), 0);
    assert_eq(dst.oft.erc20.balance_of(dst_config.user), 0);

    cheat_caller_address_once(dst.endpoint.address, dst_executor);
    dst
        .endpoint
        .endpoint
        .lz_receive(
            Origin { src_eid: src_config.eid.eid, sender: src.oft.address.into(), nonce: 1 },
            dst.oft.address,
            guid,
            message,
            "",
            0,
        );

    assert_eq(dst.native_token.erc20.balance_of(dst_config.user), 0);
    assert_eq(dst.oft.erc20.balance_of(dst_config.user), clean_amount_ld);
}
