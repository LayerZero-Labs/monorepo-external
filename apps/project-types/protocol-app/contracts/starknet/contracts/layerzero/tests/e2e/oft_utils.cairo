use core::num::traits::Pow;
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::layerzero_receiver::{
    ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
};
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use layerzero::oapps::oft::interface::IOFTDispatcher;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use openzeppelin::token::erc20::interface::IERC20Dispatcher;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::e2e::utils::{
    BlockchainOptions, DEFAULT_DVN_DST_CONFIG, DvnHelper, ERC20Helper, EndpointV2Helper,
    ExecutorHelper, TreasuryHelper, UltraLightNode302Helper, setup_layer_zero,
};
use crate::fuzzable::blockchain_config::BlockchainConfig;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::FuzzableEid;

pub const SHARED_DECIMALS: u8 = 6;
pub const LOCAL_DECIMALS: u8 = 18;
const DECIMAL_DIFF: u8 = LOCAL_DECIMALS - SHARED_DECIMALS;
pub const DIFF_DECIMALS: u256 = 10_u256.pow(DECIMAL_DIFF.into());

pub const TREASURY_NATIVE_FEE_CAP: u256 = 42;
const MOCK_GUID: Bytes32 = Bytes32 { value: 0xabcdef123456789 };

#[derive(Drop)]
pub struct OFTHelper {
    pub address: ContractAddress,
    pub oft: IOFTDispatcher,
    pub oapp: IOAppDispatcher,
    pub erc20: IERC20Dispatcher,
}

pub fn deploy_oft(
    name: @ByteArray,
    symbol: @ByteArray,
    endpoint: ContractAddress,
    owner: ContractAddress,
    native_token: ContractAddress,
) -> OFTHelper {
    let contract = declare("MockOFTCore").unwrap_syscall().contract_class();
    let mut params = array![];
    let use_mock_decimal_conversion_rate = false;

    name.serialize(ref params);
    symbol.serialize(ref params);
    endpoint.serialize(ref params);
    owner.serialize(ref params);
    native_token.serialize(ref params);
    use_mock_decimal_conversion_rate.serialize(ref params);

    let (address, _) = contract.deploy(@params).unwrap_syscall();

    OFTHelper {
        address,
        oft: IOFTDispatcher { contract_address: address },
        oapp: IOAppDispatcher { contract_address: address },
        erc20: IERC20Dispatcher { contract_address: address },
    }
}

#[derive(Drop)]
pub struct Blockchain {
    pub native_token: ERC20Helper,
    pub endpoint: EndpointV2Helper,
    pub message_lib: UltraLightNode302Helper,
    pub treasury: TreasuryHelper,
    pub oft: OFTHelper,
    pub executor: ExecutorHelper,
    pub dvn: DvnHelper,
}

pub fn setup_blockchain(config: @BlockchainConfig, remote_eid: u32) -> Blockchain {
    let chain = setup_layer_zero(
        config,
        BlockchainOptions {
            dvn_dst_config: DEFAULT_DVN_DST_CONFIG,
            treasury_native_fee_cap: TREASURY_NATIVE_FEE_CAP,
        },
        remote_eid,
    );

    let oft = deploy_oft(
        config.oft_name,
        config.oft_symbol,
        chain.endpoint.address,
        *config.oapp_owner,
        chain.native_token.address,
    );
    cheat_caller_address_once(oft.address, *config.oapp_owner);
    oft.oapp.set_delegate(*config.oapp_owner);

    Blockchain {
        native_token: chain.native_token,
        endpoint: chain.endpoint,
        message_lib: chain.message_lib,
        treasury: chain.treasury,
        executor: chain.executor,
        dvn: chain.dvn,
        oft,
    }
}

pub fn mint_tokens(
    oft: ContractAddress,
    user: ContractAddress,
    amount_sd: u64,
    endpoint: ContractAddress,
    origin: Origin,
) {
    let mut message: ByteArray = Default::default();
    let bytes: Bytes32 = user.into();
    message.append_u256(bytes.value);
    message.append_u64(amount_sd);

    cheat_caller_address_once(oft, endpoint);
    ILayerZeroReceiverDispatcher { contract_address: oft }
        .lz_receive(origin, MOCK_GUID, message, user, Default::default(), 0);
}
