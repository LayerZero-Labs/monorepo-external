use core::num::traits::Bounded;
use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::endpoint::interfaces::endpoint_v2::IEndpointV2DispatcherTrait;
use layerzero::endpoint::message_lib_manager::interface::IMessageLibManagerDispatcherTrait;
use layerzero::endpoint::messaging_composer::events::ComposeSent;
use layerzero::endpoint::messaging_composer::interface::IMessagingComposerDispatcherTrait;
use layerzero::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent;
use layerzero::message_lib::interface::IMessageLibDispatcherTrait;
use layerzero::message_lib::uln_302::options::TYPE_3;
use layerzero::message_lib::uln_302::structs::executor_config::ExecutorConfig;
use layerzero::message_lib::uln_302::structs::uln_config::UlnConfig;
use layerzero::oapps::oapp::interface::IOAppDispatcher;
use layerzero::workers::dvn::interface::IDvnDispatcherTrait;
use layerzero::workers::dvn::structs::ExecuteParam as DvnExecuteParam;
use layerzero::workers::executor::interface::IExecutorDispatcherTrait;
use layerzero::workers::executor::options::OPTION_TYPE_LZRECEIVE;
use layerzero::workers::executor::structs::ExecuteParams;
use layerzero::{Origin, Packet};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
};
use starknet::account::Call;
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::constants::{
    ALERT_COMPOSE_MESSAGE_SIZE_LIMIT, ALERT_MESSAGE_SIZE_LIMIT, SENT_COMPOSE_MESSAGE_SIZE_LIMIT,
    SENT_MESSAGE_SIZE_LIMIT,
};
use crate::e2e::utils::{
    BlockchainOptions, DEFAULT_DVN_DST_CONFIG, DEFAULT_EXECUTOR_DST_CONFIG, DvnHelper, ERC20Helper,
    EndpointV2Helper, ExecutorHelper, TreasuryHelper, UltraLightNode302Helper, setup_layer_zero,
    wire_oapp, wire_ultra_light_node_302,
};
use crate::fuzzable::blockchain_config::BlockchainConfig;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::FuzzableEid;
use crate::fuzzable::keys::FuzzableKeyPair;
use crate::mocks::erc20::interface::IMockERC20DispatcherTrait;
use crate::mocks::oapp_core::interface::{
    IMockOAppCoreDispatcher, IMockOAppCoreDispatcherTrait, IMockOAppCoreSafeDispatcher,
};
use crate::workers::dvn::utils::build_signatures;
use crate::workers::executor::utils::{
    ExecutorOptionBytes, serialize_executor_options, serialize_lz_receive_option,
};

const DVN_CONFIRMATIONS: u64 = 1;
const LZ_RECEIVE_USER_GAS: u128 = 100_000;
const TREASURY_NATIVE_FEE_CAP: u256 = 0;
const COMPOSE_TARGET: ContractAddress = 'compose_target'.try_into().unwrap();

fn build_message(size: usize) -> ByteArray {
    let mut bytes = Default::default();

    for index in 0..size {
        let byte = index % Bounded::<u8>::MAX.into();
        bytes.append_byte(byte.try_into().unwrap());
    }

    bytes
}

#[derive(Drop)]
struct OAppHelper {
    address: ContractAddress,
    oapp: IOAppDispatcher,
    mock_oapp_core: IMockOAppCoreDispatcher,
    safe_mock_oapp_core: IMockOAppCoreSafeDispatcher,
}

fn deploy_oapp(
    endpoint: ContractAddress, owner: ContractAddress, native_token: ContractAddress,
) -> OAppHelper {
    let contract = declare("MockOAppCore").unwrap_syscall().contract_class();

    let (address, _) = contract
        .deploy(@array![endpoint.into(), owner.into(), native_token.into()])
        .unwrap_syscall();

    OAppHelper {
        address,
        oapp: IOAppDispatcher { contract_address: address },
        mock_oapp_core: IMockOAppCoreDispatcher { contract_address: address },
        safe_mock_oapp_core: IMockOAppCoreSafeDispatcher { contract_address: address },
    }
}

fn deploy_compose_oapp(compose_target: ContractAddress, message: ByteArray) -> OAppHelper {
    let contract = declare("MockComposeReceiver").unwrap_syscall().contract_class();

    let mut calldata = array![];
    compose_target.serialize(ref calldata);
    message.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap_syscall();

    OAppHelper {
        address,
        oapp: IOAppDispatcher { contract_address: address },
        mock_oapp_core: IMockOAppCoreDispatcher { contract_address: address },
        safe_mock_oapp_core: IMockOAppCoreSafeDispatcher { contract_address: address },
    }
}

#[derive(Drop)]
struct Blockchain {
    native_token: ERC20Helper,
    endpoint: EndpointV2Helper,
    message_lib: UltraLightNode302Helper,
    treasury: TreasuryHelper,
    executor: ExecutorHelper,
    dvn: DvnHelper,
    oapp: OAppHelper,
    compose_oapp: OAppHelper,
}

fn setup_blockchain(config: @BlockchainConfig, remote_eid: u32) -> Blockchain {
    let chain = setup_layer_zero(
        config,
        BlockchainOptions {
            dvn_dst_config: DEFAULT_DVN_DST_CONFIG,
            treasury_native_fee_cap: TREASURY_NATIVE_FEE_CAP,
        },
        remote_eid,
    );
    let oapp = deploy_oapp(chain.endpoint.address, *config.oapp_owner, chain.native_token.address);
    let compose_oapp = deploy_compose_oapp(
        COMPOSE_TARGET, build_message(SENT_COMPOSE_MESSAGE_SIZE_LIMIT),
    );

    Blockchain {
        native_token: chain.native_token,
        endpoint: chain.endpoint,
        message_lib: chain.message_lib,
        treasury: chain.treasury,
        executor: chain.executor,
        dvn: chain.dvn,
        oapp,
        compose_oapp,
    }
}

fn create_uln_config(confirmations: u64, dvn: ContractAddress) -> UlnConfig {
    UlnConfig {
        confirmations,
        has_confirmations: true,
        required_dvns: array![dvn],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    }
}

fn create_message_options() -> ByteArray {
    let executor_options = serialize_executor_options(
        array![
            ExecutorOptionBytes {
                option_type: OPTION_TYPE_LZRECEIVE,
                option: serialize_lz_receive_option(LZ_RECEIVE_USER_GAS, None),
            },
        ],
    );

    let mut options: ByteArray = Default::default();
    options.append_u16(TYPE_3);
    options.append(@executor_options);
    options
}

#[test]
#[fuzzer(runs: 1)]
fn test_send_message_of_size_limit(src_config: BlockchainConfig, dst_config: BlockchainConfig) {
    let src = setup_blockchain(@src_config, dst_config.eid.eid);
    let dst = setup_blockchain(@dst_config, src_config.eid.eid);

    // Wire an endpoint.

    wire_ultra_light_node_302(
        src_config.message_lib_owner,
        @src.message_lib,
        dst_config.eid.eid,
        create_uln_config(DVN_CONFIRMATIONS, src.dvn.address),
        ExecutorConfig { executor: src.executor.address, max_message_size: Bounded::MAX },
    );

    wire_oapp(
        @src.endpoint,
        src.message_lib.address,
        src.oapp.oapp,
        src_config.oapp_owner,
        dst_config.eid.eid,
        dst.oapp.address,
    );

    // Send a message.

    let message = build_message(SENT_MESSAGE_SIZE_LIMIT);
    let options = create_message_options();

    let fee = src
        .oapp
        .mock_oapp_core
        .test_quote(dst_config.eid.eid, message.clone(), options.clone(), false);

    cheat_caller_address_once(src.native_token.address, src_config.native_token_owner);
    src.native_token.mock_erc20.mint(src_config.user, fee.native_fee);

    cheat_caller_address_once(src.native_token.address, src_config.user);
    src.native_token.erc20.approve(src.oapp.address, fee.native_fee);

    cheat_caller_address_once(src.oapp.address, src_config.user);
    src
        .oapp
        .mock_oapp_core
        .test_lz_send(
            src_config.user,
            dst_config.eid.eid,
            message.clone(),
            options,
            fee.clone(),
            src_config.user,
        );
}

#[test]
#[fuzzer(runs: 1)]
fn test_send_compose_message_of_size_limit(
    src_config: BlockchainConfig, dst_config: BlockchainConfig, sender: ContractAddress,
) {
    let dst = setup_blockchain(@dst_config, src_config.eid.eid);

    // Wire an endpoint.

    wire_ultra_light_node_302(
        dst_config.message_lib_owner,
        @dst.message_lib,
        src_config.eid.eid,
        create_uln_config(DVN_CONFIRMATIONS, dst.dvn.address),
        ExecutorConfig { executor: dst.executor.address, max_message_size: Bounded::MAX },
    );

    cheat_caller_address_once(dst.endpoint.address, dst_config.endpoint_owner);
    dst
        .endpoint
        .message_lib_manager
        .set_default_receive_library(src_config.eid.eid, dst.message_lib.address, 0);

    // Prepare a packet.

    let packet = Packet {
        nonce: 1,
        src_eid: src_config.eid.eid,
        sender,
        dst_eid: dst_config.eid.eid,
        receiver: dst.compose_oapp.address.into(),
        guid: Bytes32 { value: 42 },
        message: "",
    };
    let encoded_packet = PacketV1Codec::encode(@packet);

    // Verify a message with a DVN.

    let mut calldata = array![];
    PacketV1Codec::header(@encoded_packet).serialize(ref calldata);
    PacketV1Codec::payload_hash(@encoded_packet).serialize(ref calldata);
    DVN_CONFIRMATIONS.serialize(ref calldata);

    let call_data = Call {
        to: dst.message_lib.address, selector: selector!("verify"), calldata: calldata.span(),
    };
    let expiration = Bounded::MAX;
    let hash = dst.dvn.dvn.hash_call_data(dst_config.dvn_vid, call_data, expiration);
    let signatures = build_signatures(dst_config.dvn_signers.span(), hash);

    cheat_caller_address_once(dst.dvn.address, dst_config.dvn_admin);
    dst
        .dvn
        .dvn
        .execute(
            array![
                DvnExecuteParam {
                    vid: dst_config.dvn_vid, call_data, expiration, signatures: signatures.span(),
                },
            ],
        );

    // Receive a message and send a compose message with an executor.

    dst
        .message_lib
        .message_lib
        .commit(
            PacketV1Codec::header(@encoded_packet), PacketV1Codec::payload_hash(@encoded_packet),
        );

    let mut spy = spy_events();

    cheat_caller_address_once(dst.executor.address, dst_config.executor_admin);
    dst
        .executor
        .executor
        .execute(
            ExecuteParams {
                receiver: packet.receiver.try_into().unwrap(),
                origin: Origin {
                    src_eid: packet.src_eid, sender: packet.sender.into(), nonce: packet.nonce,
                },
                guid: packet.guid,
                message: packet.message,
                gas_limit: DEFAULT_EXECUTOR_DST_CONFIG.lz_receive_base_gas.into(),
                value: 0,
                extra_data: "",
            },
        );

    // We check a compose event explicitly because the `execute` call on the executor
    // always "succeeds" when it reaches the `lz_receive` call on the endpoint.
    spy
        .assert_emitted(
            @array![
                (
                    dst.endpoint.address,
                    MessagingComposerComponent::Event::ComposeSent(
                        ComposeSent {
                            from: dst.compose_oapp.address,
                            to: COMPOSE_TARGET,
                            guid: packet.guid,
                            index: 0,
                            message: build_message(SENT_COMPOSE_MESSAGE_SIZE_LIMIT),
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 1)]
fn test_lz_receive_alert_with_message_of_size_limit(
    src_config: BlockchainConfig, dst_config: BlockchainConfig,
) {
    let src = setup_blockchain(@src_config, dst_config.eid.eid);
    let dst = setup_blockchain(@dst_config, src_config.eid.eid);

    dst
        .endpoint
        .endpoint
        .lz_receive_alert(
            Origin { src_eid: src_config.eid.eid, sender: src.oapp.address.into(), nonce: 1 },
            dst.oapp.address,
            guid: Bytes32 { value: 42 },
            gas: 42,
            value: 42,
            message: build_message(ALERT_MESSAGE_SIZE_LIMIT),
            extra_data: "",
            reason: array![],
        );
}

#[test]
#[fuzzer(runs: 1)]
fn test_lz_compose_alert_with_message_of_size_limit(
    src_config: BlockchainConfig, dst_config: BlockchainConfig, compose_target: ContractAddress,
) {
    let dst = setup_blockchain(@dst_config, src_config.eid.eid);

    dst
        .endpoint
        .messaging_composer
        .lz_compose_alert(
            from: dst.oapp.address,
            to: compose_target,
            guid: Bytes32 { value: 42 },
            index: 42,
            gas: 42,
            value: 42,
            message: build_message(ALERT_COMPOSE_MESSAGE_SIZE_LIMIT),
            extra_data: "",
            reason: array![],
        );
}
