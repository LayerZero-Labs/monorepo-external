//! Shared helpers for E2E tests

use core::panic_with_felt252;
use layerzero::common::constants::{BPS_DENOMINATOR, MAX_V1_EID};
use layerzero::endpoint::endpoint_v2::EndpointV2;
use layerzero::endpoint::interfaces::endpoint_v2::IEndpointV2Dispatcher;
use layerzero::endpoint::message_lib_manager::interface::{
    IMessageLibManagerDispatcher, IMessageLibManagerDispatcherTrait,
};
use layerzero::endpoint::messaging_composer::events::ComposeSent;
use layerzero::endpoint::messaging_composer::interface::IMessagingComposerDispatcher;
use layerzero::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent;
use layerzero::message_lib::interface::{IMessageLibDispatcher, IMessageLibSafeDispatcher};
use layerzero::message_lib::sml::simple_message_lib::SimpleMessageLib::{
    ISimpleMessageLibHelpersDispatcher, ISimpleMessageLibHelpersDispatcherTrait,
};
use layerzero::message_lib::uln_302::interface::{
    IUltraLightNode302AdminDispatcher, IUltraLightNode302AdminDispatcherTrait,
};
use layerzero::message_lib::uln_302::structs::executor_config::{
    ExecutorConfig, SetDefaultExecutorConfigParam,
};
use layerzero::message_lib::uln_302::structs::uln_config::{SetDefaultUlnConfigParam, UlnConfig};
use layerzero::oapps::counter::interface::IOmniCounterDispatcher;
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use layerzero::treasury::interfaces::treasury_admin::{
    ITreasuryAdminDispatcher, ITreasuryAdminDispatcherTrait,
};
use layerzero::workers::base::interface::{IWorkerBaseDispatcher, IWorkerBaseDispatcherTrait};
use layerzero::workers::dvn::interface::{IDvnDispatcher, IDvnDispatcherTrait};
use layerzero::workers::dvn::structs::{
    DstConfig as DvnDstConfig, SetDstConfigParams as DvnSetDstConfigParams,
};
use layerzero::workers::executor;
use layerzero::workers::executor::interface::{IExecutorDispatcher, IExecutorDispatcherTrait};
use layerzero::workers::executor::structs::{
    DstConfig as ExecutorDstConfig, ExecutorOption, LzComposeOption, LzReceiveOption,
    SetDstConfigParams as ExecutorSetDstConfigParams,
};
use layerzero::workers::price_feed::interface::{
    ILayerZeroPriceFeedDispatcher, ILayerZeroPriceFeedDispatcherTrait, IPriceFeedDispatcher,
    IPriceFeedDispatcherTrait,
};
use openzeppelin::token::erc20::interface::IERC20Dispatcher;
use snforge_std::cheatcodes::events::Events;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::fuzzable::blockchain_config::BlockchainConfig;
use crate::mocks::composer_target::MockComposerTarget::IMockComposerTargetInspectDispatcher;
use crate::mocks::erc20::interface::IMockERC20Dispatcher;
use crate::workers::dvn::utils::{KeyPair, deploy_dvn_with_all_data};

pub const DEFAULT_MULTIPLIER_BPS: u16 = BPS_DENOMINATOR.try_into().unwrap();

pub const DEFAULT_EXECUTOR_DST_CONFIG: ExecutorDstConfig = ExecutorDstConfig {
    lz_receive_base_gas: 100_000,
    lz_compose_base_gas: 100_000,
    multiplier_bps: DEFAULT_MULTIPLIER_BPS,
    floor_margin_usd: 0,
    native_cap: 10_000_000_000_000_000_000 // 10 STRK
};

pub const DEFAULT_DVN_DST_CONFIG: DvnDstConfig = DvnDstConfig {
    gas: 100_000, multiplier_bps: DEFAULT_MULTIPLIER_BPS, floor_margin_usd: 0,
};

pub fn deploy_blocked_message_lib() -> ContractAddress {
    let contract = declare("BlockedMessageLib").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap_syscall();
    contract_address
}

#[derive(Drop)]
pub struct ERC20Helper {
    pub address: ContractAddress,
    pub erc20: IERC20Dispatcher,
    pub mock_erc20: IMockERC20Dispatcher,
}

pub fn deploy_erc20(supply: u256, owner: ContractAddress) -> ERC20Helper {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let mut params = array![];
    supply.serialize(ref params);
    owner.serialize(ref params);

    let (address, _) = contract.deploy(@params).unwrap_syscall();

    ERC20Helper {
        address,
        erc20: IERC20Dispatcher { contract_address: address },
        mock_erc20: IMockERC20Dispatcher { contract_address: address },
    }
}

#[derive(Drop)]
pub struct EndpointV2Helper {
    pub address: ContractAddress,
    pub endpoint: IEndpointV2Dispatcher,
    pub message_lib_manager: IMessageLibManagerDispatcher,
    pub messaging_composer: IMessagingComposerDispatcher,
}

pub fn deploy_endpoint(
    owner: ContractAddress, eid: u32, native_token: ContractAddress,
) -> EndpointV2Helper {
    let blocked_library = deploy_blocked_message_lib();
    let contract = declare("EndpointV2").unwrap_syscall().contract_class();
    let (address, _) = contract
        .deploy(@array![owner.into(), eid.into(), native_token.into(), blocked_library.into()])
        .unwrap_syscall();

    EndpointV2Helper {
        address,
        endpoint: IEndpointV2Dispatcher { contract_address: address },
        message_lib_manager: IMessageLibManagerDispatcher { contract_address: address },
        messaging_composer: IMessagingComposerDispatcher { contract_address: address },
    }
}

#[derive(Drop)]
pub struct SimpleMessageLibHelper {
    pub address: ContractAddress,
    pub message_lib: IMessageLibDispatcher,
    pub simple_message_lib_helpers: ISimpleMessageLibHelpersDispatcher,
}

pub fn deploy_simple_message_lib(endpoint: ContractAddress) -> SimpleMessageLibHelper {
    let contract = declare("SimpleMessageLib").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![endpoint.into()]).unwrap_syscall();
    let simple_message_lib_helpers = ISimpleMessageLibHelpersDispatcher {
        contract_address: address,
    };

    simple_message_lib_helpers.set_use_mock_payees();

    SimpleMessageLibHelper {
        address,
        message_lib: IMessageLibDispatcher { contract_address: address },
        simple_message_lib_helpers,
    }
}

fn deploy_dvn_fee_lib(local_eid_v2: u32, owner: ContractAddress) -> ContractAddress {
    let contract = declare("DvnFeeLib").unwrap_syscall().contract_class();

    let mut calldata = array![];
    local_eid_v2.serialize(ref calldata);
    owner.serialize(ref calldata);

    let (address, _) = contract.deploy(@calldata).unwrap_syscall();
    address
}

fn deploy_executor_fee_lib(local_eid_v2: u32, owner: ContractAddress) -> ContractAddress {
    let contract = declare("ExecutorFeeLib").unwrap_syscall().contract_class();

    let mut calldata = array![];
    local_eid_v2.serialize(ref calldata);
    owner.serialize(ref calldata);

    let (address, _) = contract.deploy(@calldata).unwrap_syscall();

    address
}

#[derive(Drop)]
pub struct OmniCounterHelper {
    pub address: ContractAddress,
    pub oapp: IOAppDispatcher,
    pub omni_counter: IOmniCounterDispatcher,
}

pub fn deploy_omni_counter(
    endpoint: ContractAddress, owner: ContractAddress, token: ContractAddress,
) -> OmniCounterHelper {
    let contract = declare("OmniCounter").unwrap_syscall().contract_class();
    let (address, _) = contract
        .deploy(@array![endpoint.into(), owner.into(), token.into()])
        .unwrap_syscall();

    OmniCounterHelper {
        address,
        oapp: IOAppDispatcher { contract_address: address },
        omni_counter: IOmniCounterDispatcher { contract_address: address },
    }
}

#[derive(Drop)]
pub struct TreasuryHelper {
    pub address: ContractAddress,
    pub treasury_admin: ITreasuryAdminDispatcher,
}

pub fn deploy_treasury(owner: ContractAddress, native_fee_bp: u256) -> TreasuryHelper {
    let contract = declare("Treasury").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![owner.into()]).unwrap_syscall();
    let dispatcher = layerzero::treasury::interfaces::treasury_admin::ITreasuryAdminDispatcher {
        contract_address: address,
    };

    cheat_caller_address_once(address, owner);
    dispatcher.set_fee_bp(native_fee_bp);

    TreasuryHelper {
        address, treasury_admin: ITreasuryAdminDispatcher { contract_address: address },
    }
}

#[derive(Drop)]
pub struct ExecutorHelper {
    pub address: ContractAddress,
    pub executor: IExecutorDispatcher,
    pub worker_base: IWorkerBaseDispatcher,
}

pub fn deploy_executor(
    endpoint: ContractAddress,
    message_lib: ContractAddress,
    price_feed: ContractAddress,
    role_admin: ContractAddress,
    admins: Array<ContractAddress>,
    native_token: ContractAddress,
    dst_config: ExecutorDstConfig,
    remote_eid: u32,
) -> ExecutorHelper {
    let mut calldata = array![];
    endpoint.serialize(ref calldata);
    array![message_lib].span().serialize(ref calldata);
    price_feed.serialize(ref calldata);
    DEFAULT_MULTIPLIER_BPS.serialize(ref calldata);
    role_admin.serialize(ref calldata);
    admins.serialize(ref calldata);
    native_token.serialize(ref calldata);

    let contract = declare("Executor").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@calldata).unwrap_syscall();

    let fee_lib = deploy_executor_fee_lib(remote_eid, role_admin);
    let worker_base = IWorkerBaseDispatcher { contract_address: address };
    let executor = IExecutorDispatcher { contract_address: address };

    cheat_caller_address_once(address, *admins[0]);
    worker_base.set_worker_fee_lib(fee_lib);
    cheat_caller_address_once(address, *admins[0]);
    executor
        .set_dst_config(
            array![ExecutorSetDstConfigParams { dst_eid: remote_eid, config: dst_config }],
        );

    ExecutorHelper { address, executor, worker_base }
}

#[derive(Drop)]
pub struct DvnHelper {
    pub address: ContractAddress,
    pub dvn: IDvnDispatcher,
    pub worker_base: IWorkerBaseDispatcher,
    pub vid: u32,
}

pub fn deploy_dvn(
    message_lib: ContractAddress,
    price_feed: ContractAddress,
    vid: u32,
    signers: @Array<KeyPair>,
    admins: Span<ContractAddress>,
    owner: ContractAddress,
    dst_config: DvnDstConfig,
    remote_eid: u32,
) -> DvnHelper {
    let multisig_threshold = signers.len();
    let address = deploy_dvn_with_all_data(
        vid,
        array![message_lib].span(),
        price_feed,
        DEFAULT_MULTIPLIER_BPS,
        signers.span().into_iter().map(|pair| *pair.public_address).collect(),
        multisig_threshold,
        admins,
        array![].span(),
        array![].span(),
    )
        .dvn;
    let fee_lib = deploy_dvn_fee_lib(remote_eid, owner);
    let worker_base = IWorkerBaseDispatcher { contract_address: address };
    let dvn = IDvnDispatcher { contract_address: address };

    cheat_caller_address_once(address, *admins[0]);
    worker_base.set_worker_fee_lib(fee_lib);
    cheat_caller_address_once(address, *admins[0]);
    dvn.set_dst_config(array![DvnSetDstConfigParams { dst_eid: remote_eid, config: dst_config }]);

    DvnHelper { address, dvn, worker_base, vid }
}

#[derive(Drop)]
pub struct UltraLightNode302Helper {
    pub address: ContractAddress,
    pub message_lib: IMessageLibDispatcher,
    pub safe_message_lib: IMessageLibSafeDispatcher,
    pub ultra_light_node_302_admin: IUltraLightNode302AdminDispatcher,
}

pub fn deploy_ultra_light_node_302(
    owner: ContractAddress,
    treasury: ContractAddress,
    endpoint: ContractAddress,
    treasury_native_fee_cap: u256,
) -> UltraLightNode302Helper {
    let contract = declare("UltraLightNode302").unwrap_syscall().contract_class();
    let mut calldata = array![owner.into(), treasury.into(), endpoint.into()];
    treasury_native_fee_cap.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap_syscall();

    UltraLightNode302Helper {
        address,
        message_lib: IMessageLibDispatcher { contract_address: address },
        safe_message_lib: IMessageLibSafeDispatcher { contract_address: address },
        ultra_light_node_302_admin: IUltraLightNode302AdminDispatcher { contract_address: address },
    }
}

/// Deploy and initialize a minimal price feed used by DVN/Executor fee libs
pub fn deploy_price_feed(owner: ContractAddress, remote_eid: u32) -> ContractAddress {
    use layerzero::workers::price_feed::structs::{
        ModelType, Price, SetEidToModelTypeParam, SetPriceParam,
    };

    let remote_eid = remote_eid % MAX_V1_EID;

    let contract = declare("PriceFeed").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![owner.into(), owner.into()]).unwrap_syscall();

    let price_ratio_denominator = ILayerZeroPriceFeedDispatcher { contract_address: address }
        .get_price_ratio_denominator();

    let price_feed = IPriceFeedDispatcher { contract_address: address };
    start_cheat_caller_address(address, owner);
    price_feed.set_native_price_usd(1);
    price_feed
        .set_eid_to_model_type(
            array![SetEidToModelTypeParam { eid: remote_eid, model_type: ModelType::DEFAULT }],
        );
    price_feed
        .set_price(
            array![
                SetPriceParam {
                    eid: remote_eid,
                    price: Price {
                        price_ratio: price_ratio_denominator, gas_price_in_unit: 1, gas_per_byte: 1,
                    },
                },
            ],
        );
    stop_cheat_caller_address(address);

    address
}

#[derive(Drop)]
pub struct MockComposerTargetHelper {
    pub address: ContractAddress,
    pub composer_target_inspect: IMockComposerTargetInspectDispatcher,
}

pub fn deploy_mock_composer_target() -> MockComposerTargetHelper {
    let target = declare("MockComposerTarget").unwrap_syscall().contract_class();
    let (address, _) = target.deploy(@array![]).unwrap_syscall();

    MockComposerTargetHelper {
        address,
        composer_target_inspect: IMockComposerTargetInspectDispatcher { contract_address: address },
    }
}

pub fn wire_ultra_light_node_302(
    uln_owner: ContractAddress,
    message_lib: @UltraLightNode302Helper,
    remote_eid: u32,
    uln_config: UlnConfig,
    executor_config: ExecutorConfig,
) {
    start_cheat_caller_address(*message_lib.address, uln_owner);

    message_lib
        .ultra_light_node_302_admin
        .set_default_uln_send_configs(
            array![SetDefaultUlnConfigParam { eid: remote_eid, config: uln_config.clone() }],
        );
    message_lib
        .ultra_light_node_302_admin
        .set_default_uln_receive_configs(
            array![SetDefaultUlnConfigParam { eid: remote_eid, config: uln_config }],
        );

    message_lib
        .ultra_light_node_302_admin
        .set_default_executor_configs(
            array![SetDefaultExecutorConfigParam { dst_eid: remote_eid, config: executor_config }],
        );

    stop_cheat_caller_address(*message_lib.address);
}

pub fn wire_oapp(
    endpoint: @EndpointV2Helper,
    message_lib: ContractAddress,
    oapp: IOAppDispatcher,
    oapp_owner: ContractAddress,
    remote_eid: u32,
    remote_oapp: ContractAddress,
) {
    cheat_caller_address_once(*endpoint.address, oapp_owner);
    endpoint.message_lib_manager.set_send_library(oapp.contract_address, remote_eid, message_lib);

    cheat_caller_address_once(*endpoint.address, oapp_owner);
    endpoint
        .message_lib_manager
        .set_receive_library(oapp.contract_address, remote_eid, message_lib, 0);

    cheat_caller_address_once(oapp.contract_address, oapp_owner);
    oapp.set_peer(remote_eid, remote_oapp.into());
}

pub fn decode_packet_on_endpoint(event: @snforge_std::Event) -> (ByteArray, ByteArray) {
    let mut keys = event.keys.span();
    let mut data = event.data.span();
    let event: EndpointV2::Event = starknet::Event::deserialize(ref keys, ref data).unwrap();

    match event {
        EndpointV2::Event::PacketSent(event) => (event.encoded_packet, event.options),
        _ => panic_with_felt252('unexpected event on endpoint'),
    }
}

pub fn decode_compose_on_endpoint(events: Events) -> ComposeSent {
    for (_, event) in events.events {
        let mut keys = event.keys.span();
        let mut data = event.data.span();
        let event: EndpointV2::Event = starknet::Event::deserialize(ref keys, ref data)
            .expect('endpoint event');

        if let EndpointV2::Event::MessagingComposerEvent(MessagingComposerComponent::Event::ComposeSent(event)) =
            event {
            return event;
        }
    }

    panic_with_felt252('no compose event on endpoint')
}

#[derive(Drop)]
pub struct BlockchainOptions {
    pub dvn_dst_config: DvnDstConfig,
    pub treasury_native_fee_cap: u256,
}

#[derive(Drop)]
pub struct Blockchain {
    pub native_token: ERC20Helper,
    pub endpoint: EndpointV2Helper,
    pub message_lib: UltraLightNode302Helper,
    pub treasury: TreasuryHelper,
    pub executor: ExecutorHelper,
    pub dvn: DvnHelper,
    pub price_feed: ContractAddress,
}

pub fn setup_layer_zero(
    config: @BlockchainConfig, options: BlockchainOptions, remote_eid: u32,
) -> Blockchain {
    let native_token = deploy_erc20(*config.native_token_supply, *config.native_token_owner);
    let endpoint = deploy_endpoint(*config.endpoint_owner, *config.eid.eid, native_token.address);
    let treasury = deploy_treasury(*config.treasury_owner, BPS_DENOMINATOR);
    let message_lib = deploy_ultra_light_node_302(
        *config.message_lib_owner,
        treasury.address,
        endpoint.address,
        options.treasury_native_fee_cap,
    );

    cheat_caller_address_once(endpoint.address, *config.endpoint_owner);
    endpoint.message_lib_manager.register_library(message_lib.address);

    let price_feed = deploy_price_feed(*config.price_feed_owner, remote_eid);

    let executor = deploy_executor(
        endpoint.address,
        message_lib.address,
        price_feed,
        *config.executor_role_admin,
        array![*config.executor_admin],
        native_token.address,
        DEFAULT_EXECUTOR_DST_CONFIG,
        remote_eid,
    );
    let dvn = deploy_dvn(
        message_lib.address,
        price_feed,
        *config.dvn_vid,
        config.dvn_signers,
        array![*config.dvn_admin].span(),
        *config.dvn_owner,
        options.dvn_dst_config,
        remote_eid,
    );

    Blockchain { native_token, endpoint, message_lib, treasury, executor, dvn, price_feed }
}

#[derive(Debug, Drop)]
pub struct DecodedExecutorOptions {
    pub receive: @LzReceiveOption,
    pub compose: Array<@LzComposeOption>,
}

pub fn decode_executor_options(options: @ByteArray) -> DecodedExecutorOptions {
    let options = executor::options::_parse_options_to_array(options);

    DecodedExecutorOptions {
        receive: {
            let mut options = options.span().into_iter();
            let mut options = options
                .map(
                    |option| if let ExecutorOption::LzReceive(option) = option {
                        Some(option)
                    } else {
                        None
                    },
                )
                .filter(|option| option.is_some());

            options.next().unwrap().unwrap()
        },
        compose: {
            let mut options = options.span().into_iter();

            options
                .map(
                    |option| if let ExecutorOption::LzCompose(option) = option {
                        Some(option)
                    } else {
                        None
                    },
                )
                .filter(|option| option.is_some())
                .map(|option| option.unwrap())
                .collect()
        },
    }
}
