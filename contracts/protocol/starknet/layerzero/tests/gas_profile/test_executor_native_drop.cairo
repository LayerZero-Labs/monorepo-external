use layerzero::Origin;
use layerzero::workers::executor::events::NativeDropApplied;
use layerzero::workers::executor::executor::Executor;
use layerzero::workers::executor::interface::IExecutorDispatcherTrait;
use layerzero::workers::executor::structs::NativeDropParams;
use lz_utils::bytes::ContractAddressIntoBytes32;
use snforge_std::{EventSpyAssertionsTrait, Token, set_balance, spy_events};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::e2e::utils::{
    deploy_endpoint, deploy_executor, deploy_price_feed, deploy_treasury,
    deploy_ultra_light_node_302,
};
use crate::gas_profile::utils::{
    ENDPOINT_OWNER, EXECUTOR_ADMIN, EXECUTOR_DST_CONFIG, EXECUTOR_ROLE_ADMIN, LOCAL_EID,
    MESSAGE_LIB_OWNER, PRICE_FEED_OWNER, REMOTE_EID, REMOTE_OAPP, TREASURY_OWNER, get_native_token,
};

const LOCAL_OAPP: ContractAddress = 'local_oapp'.try_into().unwrap();
const NATIVE_DROP_AMOUNT: u256 = 42;

#[test]
fn test_native_drop() {
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

    let origin = Origin { src_eid: REMOTE_EID, sender: REMOTE_OAPP.into(), nonce: 1 };
    let params = array![NativeDropParams { receiver: LOCAL_OAPP, amount: NATIVE_DROP_AMOUNT }];

    set_balance(executor.address, NATIVE_DROP_AMOUNT, Token::STRK);

    let mut spy = spy_events();

    cheat_caller_address_once(executor.address, EXECUTOR_ADMIN);
    executor.executor.native_drop(origin.clone(), LOCAL_OAPP, params.clone());

    // We check a native drop event explicitly because the `native_drop` call does not panic even if
    // it involves an invalid transfer.
    spy
        .assert_emitted(
            @array![
                (
                    executor.address,
                    Executor::Event::NativeDropApplied(
                        NativeDropApplied {
                            origin,
                            dst_eid: LOCAL_EID,
                            oapp: LOCAL_OAPP,
                            native_drop_params: params,
                            success: array![true],
                        },
                    ),
                ),
            ],
        );
}
