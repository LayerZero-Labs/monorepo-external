use layerzero::endpoint::message_lib_manager::interface::IMessageLibManagerDispatcherTrait;
use layerzero::message_lib::uln_302::options::TYPE_3;
use layerzero::message_lib::uln_302::structs::executor_config::ExecutorConfig;
use layerzero::oapps::counter::constants::VANILLA_TYPE;
use layerzero::oapps::counter::interface::IOmniCounterDispatcherTrait;
use layerzero::oapps::oapp::interface::IOAppDispatcherTrait;
use layerzero::workers::executor::options::OPTION_TYPE_LZRECEIVE;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::ContractAddressIntoBytes32;
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::{Token, set_balance};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::e2e::utils::{
    deploy_dvn, deploy_endpoint, deploy_executor, deploy_omni_counter, deploy_price_feed,
    deploy_treasury, deploy_ultra_light_node_302, wire_oapp, wire_ultra_light_node_302,
};
use crate::gas_profile::utils::{
    DVN_ADMIN, DVN_DST_CONFIG, DVN_OWNER, ENDPOINT_OWNER, EXECUTOR_ADMIN, EXECUTOR_DST_CONFIG,
    EXECUTOR_ROLE_ADMIN, LOCAL_EID, LOCAL_OAPP_OWNER, MAX_MESSAGE_SIZE, MESSAGE_LIB_OWNER,
    PRICE_FEED_OWNER, REMOTE_EID, REMOTE_OAPP, TREASURY_OWNER, build_dvn_signers, create_uln_config,
    get_native_token,
};
use crate::workers::executor::utils::{
    ExecutorOptionBytes, serialize_executor_options, serialize_lz_receive_option,
};

const DVN_COUNT: u32 = 2;
const USER: ContractAddress = 'user'.try_into().unwrap();
const LZ_RECEIVE_USER_GAS: u128 = 1_000_000;

fn create_message_options() -> ByteArray {
    let mut options: ByteArray = Default::default();

    options.append_u16(TYPE_3);
    options
        .append(
            @serialize_executor_options(
                array![
                    ExecutorOptionBytes {
                        option_type: OPTION_TYPE_LZRECEIVE,
                        option: serialize_lz_receive_option(LZ_RECEIVE_USER_GAS, None),
                    },
                ],
            ),
        );

    options
}

#[test]
fn test_increment() {
    let native_token = get_native_token();
    let endpoint = deploy_endpoint(ENDPOINT_OWNER, LOCAL_EID, native_token.address);
    let treasury = deploy_treasury(TREASURY_OWNER, 0);
    let message_lib = deploy_ultra_light_node_302(
        MESSAGE_LIB_OWNER, treasury.address, endpoint.address, 0,
    );
    let price_feed = deploy_price_feed(PRICE_FEED_OWNER, REMOTE_EID);
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
    let signers = build_dvn_signers();
    let dvns = (0..DVN_COUNT)
        .into_iter()
        .map(
            |
                vid,
            | deploy_dvn(
                message_lib.address,
                price_feed,
                vid,
                @signers,
                array![DVN_ADMIN].span(),
                DVN_OWNER,
                DVN_DST_CONFIG,
                REMOTE_EID,
            ),
        )
        .collect::<Array<_>>();
    let counter = deploy_omni_counter(endpoint.address, LOCAL_OAPP_OWNER, native_token.address);

    cheat_caller_address_once(counter.address, LOCAL_OAPP_OWNER);
    counter.oapp.set_delegate(LOCAL_OAPP_OWNER);

    wire_ultra_light_node_302(
        MESSAGE_LIB_OWNER,
        @message_lib,
        REMOTE_EID,
        create_uln_config(dvns.span().into_iter().map(|dvn| *dvn.address).collect()),
        ExecutorConfig { executor: executor.address, max_message_size: MAX_MESSAGE_SIZE },
    );

    cheat_caller_address_once(endpoint.address, ENDPOINT_OWNER);
    endpoint.message_lib_manager.register_library(message_lib.address);

    wire_oapp(
        @endpoint, message_lib.address, counter.oapp, LOCAL_OAPP_OWNER, REMOTE_EID, REMOTE_OAPP,
    );

    let options = create_message_options();
    let fee = counter.omni_counter.quote(REMOTE_EID, VANILLA_TYPE, options.clone(), false);

    set_balance(USER, fee.native_fee, Token::STRK);

    cheat_caller_address_once(native_token.address, USER);
    native_token.erc20.approve(counter.address, fee.native_fee);

    cheat_caller_address_once(counter.address, USER);
    counter.omni_counter.increment(REMOTE_EID, VANILLA_TYPE, options, fee, USER);
}
