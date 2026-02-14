use core::num::traits::{Bounded, Pow};
use layerzero::Packet;
use layerzero::common::constants::BPS_DENOMINATOR;
use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::message_lib::uln_302::structs::uln_config::UlnConfig;
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use layerzero::workers::dvn::structs::DstConfig as DvnDstConfig;
use layerzero::workers::executor::structs::DstConfig as ExecutorDstConfig;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use openzeppelin::token::erc20::interface::IERC20Dispatcher;
use snforge_std::{ContractClassTrait, DeclareResultTrait, Token, TokenTrait, declare};
use starknet::account::Call;
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::utils::sort;
use crate::workers::dvn::utils::{KeyPair, key_pair_from_private_key};

pub const MAX_MESSAGE_SIZE: u32 = Bounded::MAX;
const ERROR_MESSAGE_SIZE: usize = 256;

const MESSAGE_SIZE_STEPS: usize = 5;

pub const LOCAL_EID: u32 = 0;
pub const REMOTE_EID: u32 = 1;

pub const NATIVE_TOKEN_OWNER: ContractAddress = 'native_token_owner'.try_into().unwrap();
pub const ENDPOINT_OWNER: ContractAddress = 'endpoint_owner'.try_into().unwrap();
pub const TREASURY_OWNER: ContractAddress = 'treasury_owner'.try_into().unwrap();
pub const MESSAGE_LIB_OWNER: ContractAddress = 'message_lib_owner'.try_into().unwrap();
pub const PRICE_FEED_OWNER: ContractAddress = 'price_feed_owner'.try_into().unwrap();

const WORKER_BASE_GAS: u64 = 1_000_000;

pub const EXECUTOR_ROLE_ADMIN: ContractAddress = 'executor_role_admin'.try_into().unwrap();
pub const EXECUTOR_ADMIN: ContractAddress = 'executor_admin'.try_into().unwrap();
pub const EXECUTOR_DST_CONFIG: ExecutorDstConfig = ExecutorDstConfig {
    lz_receive_base_gas: WORKER_BASE_GAS,
    lz_compose_base_gas: WORKER_BASE_GAS,
    multiplier_bps: BPS_DENOMINATOR.try_into().unwrap(),
    floor_margin_usd: 0,
    native_cap: 10_u128.pow(18),
};

pub const DVN_OWNER: ContractAddress = 'dvn_owner'.try_into().unwrap();
pub const DVN_ADMIN: ContractAddress = 'dvn_admin'.try_into().unwrap();
pub const DVN_DST_CONFIG: DvnDstConfig = DvnDstConfig {
    gas: WORKER_BASE_GAS, multiplier_bps: BPS_DENOMINATOR.try_into().unwrap(), floor_margin_usd: 0,
};
pub const DVN_CONFIRMATIONS: u64 = 1;
pub const DVN_CALL_DATA_EXPIRATION: u256 = Bounded::MAX;

pub const SIGNER_PRIVATE_KEY_1: u256 = 123;
pub const SIGNER_PRIVATE_KEY_2: u256 = 456;
pub const SIGNER_PRIVATE_KEY_3: u256 = 789;

pub const LOCAL_OAPP_OWNER: ContractAddress = 'local_oapp_owner'.try_into().unwrap();
pub const REMOTE_OAPP: ContractAddress = 'remote_oapp'.try_into().unwrap();

#[derive(Drop)]
pub struct NativeTokenHelper {
    pub address: ContractAddress,
    pub erc20: IERC20Dispatcher,
}

pub fn get_native_token() -> NativeTokenHelper {
    let address = Token::STRK.contract_address();

    NativeTokenHelper { address, erc20: IERC20Dispatcher { contract_address: address } }
}

pub fn build_dvn_signers() -> Array<KeyPair> {
    array![SIGNER_PRIVATE_KEY_1, SIGNER_PRIVATE_KEY_2, SIGNER_PRIVATE_KEY_3]
        .into_iter()
        .map(|key| key_pair_from_private_key(key))
        .collect()
}

pub fn create_uln_config(dvns: Array<ContractAddress>) -> UlnConfig {
    UlnConfig {
        confirmations: DVN_CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: sort(dvns),
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    }
}

pub fn build_byte_array(size: usize) -> ByteArray {
    let mut bytes = Default::default();

    for index in 0..size {
        let byte = index % Bounded::<u8>::MAX.into();
        bytes.append_byte(byte.try_into().unwrap());
    }

    bytes
}

pub fn build_alert_reason() -> Array<felt252> {
    let mut reason = array![];

    build_byte_array(ERROR_MESSAGE_SIZE).serialize(ref reason);

    reason
}

pub fn build_incoming_packet(receiver: ContractAddress, message: ByteArray) -> Packet {
    Packet {
        nonce: 1,
        src_eid: REMOTE_EID,
        sender: REMOTE_OAPP,
        dst_eid: LOCAL_EID,
        receiver: receiver.into(),
        guid: Bytes32 { value: 0 },
        message,
    }
}

pub fn build_dvn_verification_call_data(message_lib: ContractAddress, packet: @ByteArray) -> Call {
    let mut calldata = array![];
    PacketV1Codec::header(packet).serialize(ref calldata);
    PacketV1Codec::payload_hash(packet).serialize(ref calldata);
    DVN_CONFIRMATIONS.serialize(ref calldata);

    Call { to: message_lib, selector: selector!("verify"), calldata: calldata.span() }
}

#[derive(Drop)]
pub struct OAppHelper {
    pub address: ContractAddress,
    pub oapp: IOAppDispatcher,
}

pub fn deploy_oapp(endpoint: ContractAddress, native_token: ContractAddress) -> OAppHelper {
    let contract = declare("MockOAppCore").unwrap_syscall().contract_class();
    let (address, _) = contract
        .deploy(@array![endpoint.into(), LOCAL_OAPP_OWNER.into(), native_token.into()])
        .unwrap();
    let oapp = IOAppDispatcher { contract_address: address };

    cheat_caller_address_once(address, LOCAL_OAPP_OWNER);
    oapp.set_delegate(LOCAL_OAPP_OWNER);

    OAppHelper { address, oapp: oapp }
}

pub fn deploy_compose_oapp(compose_target: ContractAddress, message: ByteArray) -> ContractAddress {
    let contract = declare("MockComposeReceiver").unwrap_syscall().contract_class();
    let mut calldata = array![];
    compose_target.serialize(ref calldata);
    message.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();

    address
}

pub fn deploy_composer_target() -> ContractAddress {
    let contract = declare("MockComposerTarget").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap_syscall();

    address
}
