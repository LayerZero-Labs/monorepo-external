//! Price feed tests

use layerzero::common::constants::MAX_V1_EID;
use layerzero::workers::price_feed::constants::PRICE_RATIO_DENOMINATOR;
use layerzero::workers::price_feed::errors::{
    err_lz_price_feed_only_price_updater, err_price_ratio_denominator_zero, err_transfer_failed,
};
use layerzero::workers::price_feed::events::FeeWithdrawn;
use layerzero::workers::price_feed::interface::{
    ILayerZeroPriceFeedDispatcher, ILayerZeroPriceFeedDispatcherTrait, IPriceFeedDispatcherTrait,
    IPriceFeedSafeDispatcherTrait,
};
use layerzero::workers::price_feed::price_feed::PriceFeed::{
    ETHEREUM_MAINNET_EID, Event as PriceFeedEvent,
};
use layerzero::workers::price_feed::structs::{
    ArbitrumPriceExt, GetFeeResponse, ModelType, Price, SetEidToModelTypeParam, SetPriceParam,
    UpdatePriceExt,
};
use openzeppelin::access::ownable::OwnableComponent;
use openzeppelin::token::erc20::ERC20Component::{Event as ERC20Event, Transfer};
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::fuzzable::{FuzzableU256, FuzzableU32};
use snforge_std::{
    DeclareResultTrait, EventSpyAssertionsTrait, declare, get_class_hash, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::constants::assert_eq;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::model_type::FuzzableModelType;
use crate::fuzzable::price::{FuzzableArbitrumPriceExt, FuzzablePrice};
use crate::workers::base::utils::{ERC20Mock, deploy_mock_erc20};
use crate::workers::price_feed::utils::{PriceFeedDeploy, TEN_GWEI, deploy_price_feed};

const OWNER: ContractAddress = 'owner'.try_into().unwrap();
const PRICE_UPDATER: ContractAddress = 'price_updater'.try_into().unwrap();
const ENDPOINT: ContractAddress = 'endpoint'.try_into().unwrap();
const NATIVE_PRICE_USD: u128 = 1234567890;
const ARBITRUM_COMPRESSION_PERCENT: u32 = 100;

#[test]
#[fuzzer(runs: 10)]
fn should_set_eid_to_model_type(
    owner: ContractAddress, price_updater: ContractAddress, eid_1: Eid, eid_2: Eid, eid_3: Eid,
) {
    let eid_1 = eid_1.eid;
    let eid_2 = eid_2.eid;
    let eid_3 = eid_3.eid;

    // Ensure that eid_1, eid_2, and eid_3 are all different
    if eid_1 == eid_2 || eid_1 == eid_3 || eid_2 == eid_3 {
        return;
    }

    let params = array![
        SetEidToModelTypeParam { eid: eid_1, model_type: ModelType::ARB_STACK },
        SetEidToModelTypeParam { eid: eid_2, model_type: ModelType::OP_STACK },
        SetEidToModelTypeParam { eid: eid_3, model_type: ModelType::DEFAULT },
    ];
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(owner, price_updater);

    // Caller is the owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.set_eid_to_model_type(params);

    // Check that the model type is set correctly
    assert_eq(dispatcher.get_eid_to_model_type(eid_1), ModelType::ARB_STACK);
    assert_eq(dispatcher.get_eid_to_model_type(eid_2), ModelType::OP_STACK);
    assert_eq(dispatcher.get_eid_to_model_type(eid_3), ModelType::DEFAULT);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_eid_to_model_type_when_not_owner(
    owner: ContractAddress,
    not_owner: ContractAddress,
    price_updater: ContractAddress,
    eid: Eid,
    model_type: ModelType,
) {
    // Ensure that not_owner is not the owner
    // We are testing the case where the caller is not the owner
    if owner == not_owner {
        return;
    }

    let eid = eid.eid;
    let params = array![SetEidToModelTypeParam { eid, model_type }];
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is not the owner
    cheat_caller_address_once(price_feed, not_owner);
    let res = safe_dispatcher.set_eid_to_model_type(params);

    // Check that the model type is not set
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[fuzzer(runs: 10)]
fn should_set_price(
    owner: ContractAddress, price_updater: ContractAddress, eid: Eid, price: Price,
) {
    let eid = eid.eid;
    let params = array![SetPriceParam { eid, price: price.clone() }];
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is the owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.set_price(params);

    // Check that the price is set correctly
    assert_eq(layer_zero.get_price(eid), price);
}

#[test]
#[fuzzer(runs: 10)]
fn should_set_price_by_price_updater(
    owner: ContractAddress, price_updater: ContractAddress, eid: Eid, price: Price,
) {
    let eid = eid.eid;
    let params = array![SetPriceParam { eid, price }];
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(owner, price_updater);

    // Caller is the price updater
    cheat_caller_address_once(price_feed, price_updater);
    dispatcher.set_price(params);

    // Check that the price updater is set correctly
    assert(dispatcher.get_price_updater(price_updater), 'Price updater should be set');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_price_when_not_owner_or_price_updater(
    owner: ContractAddress,
    not_owner_or_price_updater: ContractAddress,
    price_updater: ContractAddress,
    eid: Eid,
    price: Price,
) {
    let eid = eid.eid;
    let params = array![SetPriceParam { eid, price }];
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is not the owner or the price updater
    cheat_caller_address_once(price_feed, not_owner_or_price_updater);
    let res = safe_dispatcher.set_price(params);

    // Check that set_price panics with the expected error
    assert_panic_with_error(res, err_lz_price_feed_only_price_updater());
}

#[test]
#[fuzzer(runs: 10)]
fn should_estimate_fee_with_default_model(
    owner: ContractAddress, price_updater: ContractAddress, eid: Eid, price: Price,
) {
    let eid = eid.eid;
    let calldata_size: u32 = 100;
    let gas: u256 = 50000;

    let price = Price {
        gas_price_in_unit: TEN_GWEI, gas_per_byte: 16, price_ratio: 2 * PRICE_RATIO_DENOMINATOR,
    };
    let params = array![SetPriceParam { eid: eid % MAX_V1_EID, price: price.clone() }];
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is the owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.set_price(params);

    let estimate = layer_zero.estimate_fee_on_send(eid, calldata_size, gas);

    // gas_for_call_data = calldata_size * gas_per_byte = 100 * 16 = 1600
    // remote_fee = (gas_for_call_data + gas) * gas_price_in_unit
    // remote_fee = (1600 + 50000) * 10_000_000_000 = 516_000_000_000_000
    // expected_gas_fee = remote_fee * price_ratio / PRICE_RATIO_DENOMINATOR
    // expected_gas_fee = 516_000_000_000_000 * 200000000000000000000 / 100000000000000000000 =
    let expected_estimate = GetFeeResponse {
        gas_fee: 1_032_000_000_000_000,
        price_ratio: price.price_ratio,
        price_ratio_denominator: PRICE_RATIO_DENOMINATOR,
        native_price_usd: 0,
    };

    // Check that the fee estimate is correct
    assert_eq(estimate, expected_estimate);
}

#[test]
#[fuzzer(runs: 10)]
fn should_return_zero_for_get_fee(
    owner: ContractAddress,
    price_updater: ContractAddress,
    eid: Eid,
    calldata_size: u256,
    gas: u256,
) {
    let eid = eid.eid;
    let PriceFeedDeploy { layer_zero, .. } = deploy_price_feed(owner, price_updater);
    assert_eq(layer_zero.get_fee(eid, calldata_size, gas), 0);
}

///////////////////
// Upgrade tests //
///////////////////

#[test]
#[fuzzer(runs: 10)]
fn upgrade_succeeds(owner: ContractAddress, price_updater: ContractAddress) {
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(owner, price_updater);
    let new_class_hash = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;

    // Caller is the owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.upgrade(*new_class_hash);

    // Check that the contract is upgraded
    assert_eq(get_class_hash(price_feed), *new_class_hash);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn upgrade_fails_when_not_owner(
    owner: ContractAddress, not_owner: ContractAddress, price_updater: ContractAddress,
) {
    // Ensure that not_owner is not the owner
    // We are testing the case where the caller is not the owner
    if owner == not_owner {
        return;
    }

    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);
    let new_class_hash = declare("MockBaseWorker").unwrap_syscall().contract_class().class_hash;

    // Caller is not the owner
    cheat_caller_address_once(price_feed, not_owner);
    let res = safe_dispatcher.upgrade(*new_class_hash);

    // Check that upgrade panics with the expected error
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[fuzzer(runs: 10)]
fn upgrade_and_call_succeeds(owner: ContractAddress, price_updater: ContractAddress) {
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(owner, price_updater);
    let new_class_hash = declare("PriceFeed").unwrap_syscall().contract_class().class_hash;

    // Call data
    let endpoint: ContractAddress = 'endpoint'.try_into().unwrap();
    let call_data = array![endpoint.into()];

    // Upgrade and call
    // Caller is the owner
    start_cheat_caller_address(price_feed, owner);
    dispatcher.upgrade_and_call(*new_class_hash, selector!("set_endpoint"), call_data.span());
    stop_cheat_caller_address(price_feed);

    // Check that the function was called correctly
    assert_eq(dispatcher.get_endpoint(), endpoint);

    // Check that the contract is upgraded
    assert_eq(get_class_hash(price_feed), *new_class_hash);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn upgrade_and_call_fails_when_not_owner(
    owner: ContractAddress, not_owner: ContractAddress, price_updater: ContractAddress,
) {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);
    let new_class_hash = declare("PriceFeed").unwrap_syscall().contract_class().class_hash;

    // Caller is not the owner
    cheat_caller_address_once(price_feed, not_owner);
    let res = safe_dispatcher.upgrade_and_call(*new_class_hash, 0, array![].span());

    // Check that upgrade panics with the expected error
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

/////////////////////////
// Price updater tests //
/////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn should_set_price_updater(
    owner: ContractAddress,
    price_updater: ContractAddress,
    new_price_updater: ContractAddress,
    eid: Eid,
    price: Price,
) {
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(owner, price_updater);

    // Set new price updater via owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.set_price_updater(new_price_updater, true);

    // Check that the new price updater is set
    assert(dispatcher.get_price_updater(new_price_updater), 'Price updater should be set');

    let eid = eid.eid;
    let params = array![SetPriceParam { eid, price: price.clone() }];

    // Set the price via the new price updater
    cheat_caller_address_once(price_feed, new_price_updater);
    dispatcher.set_price(params);

    // Check that the price is set correctly
    assert_eq(layer_zero.get_price(eid), price);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_price_updater_when_not_owner(
    owner: ContractAddress,
    not_owner: ContractAddress,
    price_updater: ContractAddress,
    new_price_updater: ContractAddress,
) {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is not the owner
    cheat_caller_address_once(price_feed, not_owner);
    let res = safe_dispatcher.set_price_updater(new_price_updater, true);

    // Check that set_price_updater panics with the expected error
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[fuzzer(runs: 10)]
fn should_estimate_fee_with_optimism_model(owner: ContractAddress, price_updater: ContractAddress) {
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(owner, price_updater);

    let eid = 1;
    let calldata_size = 100;
    let gas = 50000;

    let l2_price = Price {
        gas_price_in_unit: TEN_GWEI, gas_per_byte: 16, price_ratio: PRICE_RATIO_DENOMINATOR,
    };
    let l1_price = Price {
        gas_price_in_unit: 2 * TEN_GWEI, gas_per_byte: 0, price_ratio: PRICE_RATIO_DENOMINATOR,
    };

    let model_params = array![SetEidToModelTypeParam { eid, model_type: ModelType::OP_STACK }];
    let prices_params = array![
        SetPriceParam { eid, price: l2_price.clone() },
        SetPriceParam { eid: ETHEREUM_MAINNET_EID, price: l1_price.clone() },
    ];

    // Caller is the owner, set model type and prices
    start_cheat_caller_address(price_feed, owner);
    dispatcher.set_eid_to_model_type(model_params);
    dispatcher.set_price(prices_params);
    stop_cheat_caller_address(price_feed);

    // Check that the model type is set correctly
    assert_eq(dispatcher.get_eid_to_model_type(eid), ModelType::OP_STACK);

    // Estimate fee
    let estimate = layer_zero.estimate_fee_on_send(eid, calldata_size, gas);

    // L2 fee
    // gas_for_l2_call_data = payload_size * gas_per_byte = 100 * 16 = 1600
    // l2_fee = (gas_for_l2_call_data + gas) * gas_price_in_unit = (1600 + 50000) * 10e9 =
    // 516_000_000_000_000
    //
    // L1 fee
    // gas_for_l1_call_data = (payload_size * gas_per_byte) + 3188 = (100 * 0) + 3188 = 3188
    // l1_fee = gas_for_l1_call_data * gas_price_in_unit = 3188 * 20e9 = 63_760_000_000_000
    //
    // Total fee
    // total_fee = l1_fee + l2_fee = 516_000_000_000_000 + 63_760_000_000_000 = 579_760_000_000_000
    let expected_estimate = GetFeeResponse {
        gas_fee: 579_760_000_000_000,
        price_ratio: l2_price.price_ratio,
        price_ratio_denominator: PRICE_RATIO_DENOMINATOR,
        native_price_usd: 0,
    };

    // Check that the fee estimate is correct
    assert_eq(estimate, expected_estimate);
}

#[test]
#[fuzzer(runs: 10)]
fn should_estimate_fee_with_arbitrum_model(
    owner: ContractAddress, price_updater: ContractAddress, eid: Eid, price: Price,
) {
    let eid = eid.eid;
    let normal_eid = eid % MAX_V1_EID;
    let calldata_size: u32 = 100;
    let gas: u256 = 50000;

    let price = UpdatePriceExt {
        eid: normal_eid,
        price: Price {
            gas_price_in_unit: TEN_GWEI, gas_per_byte: 0, price_ratio: PRICE_RATIO_DENOMINATOR,
        },
        extend: ArbitrumPriceExt { gas_per_l2_tx: 1_000_000, gas_per_l1_call_data_byte: 16 },
    };
    let model_params = array![
        SetEidToModelTypeParam { eid: normal_eid, model_type: ModelType::ARB_STACK },
    ];
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is the owner
    start_cheat_caller_address(price_feed, owner);
    dispatcher.set_eid_to_model_type(model_params);
    dispatcher.set_price_for_arbitrum(price.clone());
    stop_cheat_caller_address(price_feed);

    // Check that the model type is set correctly
    assert_eq(dispatcher.get_eid_to_model_type(normal_eid), ModelType::ARB_STACK);

    // Estimate fee
    let estimate = layer_zero.estimate_fee_on_send(eid, calldata_size, gas);

    // gas_for_l1_call_data = ((payload_size * arbitrum_compression_percent) / 100) *
    // gas_per_l1_call_data_byte gas_for_l1_call_data = ((100 * 47) / 100) * 16 = 752
    // gas_for_l2_call_data = payload_size * gas_per_byte = 100 * 0 = 0
    // total_gas = gas + gas_per_l2_tx + gas_for_l1_call_data + gas_for_l2_call_data
    // total_gas = 50000 + 1_000_000 + 752 + 0 = 1_050_752
    // fee = total_gas * gas_price_in_unit = 1_050_752 * 10_000_000_000 = 10_507_520_000_000_000
    let expected_estimate = GetFeeResponse {
        gas_fee: 10_507_520_000_000_000,
        price_ratio: price.price.price_ratio,
        price_ratio_denominator: PRICE_RATIO_DENOMINATOR,
        native_price_usd: 0,
    };

    // Check that the fee estimate is correct
    assert_eq(estimate, expected_estimate);
}

#[test]
#[fuzzer(runs: 10)]
fn should_set_price_for_arbitrum_by_price_updater(
    owner: ContractAddress,
    price_updater: ContractAddress,
    eid: Eid,
    price: Price,
    extend: ArbitrumPriceExt,
) {
    let eid = eid.eid;
    let price = UpdatePriceExt { eid, price, extend: extend.clone() };
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(owner, price_updater);

    // Caller is the price updater
    cheat_caller_address_once(price_feed, price_updater);
    dispatcher.set_price_for_arbitrum(price.clone());

    // Check that the price is set correctly
    assert_eq(dispatcher.get_price_arbitrum_ext(eid), extend);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_price_for_arbitrum_when_not_price_updater_or_owner(
    owner: ContractAddress,
    not_price_updater_or_owner: ContractAddress,
    price_updater: ContractAddress,
    eid: Eid,
    price: Price,
    extend: ArbitrumPriceExt,
) {
    let eid = eid.eid;
    let price = UpdatePriceExt { eid, price, extend: extend.clone() };
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is not the price updater or the owner
    cheat_caller_address_once(price_feed, not_price_updater_or_owner);
    let res = safe_dispatcher.set_price_for_arbitrum(price);

    // Check that set_price_for_arbitrum panics with the expected error
    assert_panic_with_error(res, err_lz_price_feed_only_price_updater());
}

#[test]
#[fuzzer(runs: 10)]
fn should_update_price_and_reestimate_fee(
    owner: ContractAddress, price_updater: ContractAddress, eid: Eid, price: Price,
) {
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(owner, price_updater);

    let eid = eid.eid;
    let calldata_size: u32 = 100;
    let gas: u256 = 50000;

    // First price
    let price_1 = Price {
        gas_price_in_unit: TEN_GWEI, gas_per_byte: 16, price_ratio: 2 * PRICE_RATIO_DENOMINATOR,
    };
    let params_1 = array![SetPriceParam { eid: eid % MAX_V1_EID, price: price_1.clone() }];

    // Caller is the owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.set_price(params_1);

    let estimate_1 = layer_zero.estimate_fee_on_send(eid, calldata_size, gas);
    let expected_estimate_1 = GetFeeResponse {
        gas_fee: 1_032_000_000_000_000,
        price_ratio: price_1.price_ratio,
        price_ratio_denominator: PRICE_RATIO_DENOMINATOR,
        native_price_usd: 0,
    };
    assert_eq(estimate_1, expected_estimate_1);

    // Second price
    let price_2 = Price {
        gas_price_in_unit: 2 * TEN_GWEI, gas_per_byte: 32, price_ratio: 3 * PRICE_RATIO_DENOMINATOR,
    };
    let params_2 = array![SetPriceParam { eid: eid % MAX_V1_EID, price: price_2.clone() }];

    // Caller is the owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.set_price(params_2);

    let estimate_2 = layer_zero.estimate_fee_on_send(eid, calldata_size, gas);

    // gas_for_call_data = 100 * 32 = 3200
    // remote_fee = (3200 + 50000) * 20_000_000_000 = 1_064_000_000_000_000
    // expected_gas_fee = 1_064_000_000_000_000 * 3 = 3_192_000_000_000_000
    let expected_estimate_2 = GetFeeResponse {
        gas_fee: 3_192_000_000_000_000,
        price_ratio: price_2.price_ratio,
        price_ratio_denominator: PRICE_RATIO_DENOMINATOR,
        native_price_usd: 0,
    };
    assert_eq(estimate_2, expected_estimate_2);
}


#[test]
#[fuzzer(runs: 10)]
fn should_view_estimate_fee_by_eid(
    owner: ContractAddress, price_updater: ContractAddress, eid: Eid, price: Price,
) {
    let eid = eid.eid;
    let calldata_size: u32 = 100;
    let gas: u256 = 50000;

    let price = Price {
        gas_price_in_unit: TEN_GWEI, gas_per_byte: 16, price_ratio: 2 * PRICE_RATIO_DENOMINATOR,
    };
    let params = array![SetPriceParam { eid: eid % MAX_V1_EID, price: price.clone() }];
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(owner, price_updater);

    // Caller is the owner
    cheat_caller_address_once(price_feed, owner);
    dispatcher.set_price(params);

    let estimate = layer_zero.estimate_fee_by_eid(eid, calldata_size, gas);

    // gas_for_call_data = calldata_size * gas_per_byte = 100 * 16 = 1600
    // remote_fee = (gas_for_call_data + gas) * gas_price_in_unit
    // remote_fee = (1600 + 50000) * 10_000_000_000 = 516_000_000_000_000
    // expected_gas_fee = remote_fee * price_ratio / PRICE_RATIO_DENOMINATOR
    // expected_gas_fee = 516_000_000_000_000 * 200000000000000000000 / 100000000000000000000 =
    let expected_estimate = GetFeeResponse {
        gas_fee: 1_032_000_000_000_000,
        price_ratio: price.price_ratio,
        price_ratio_denominator: PRICE_RATIO_DENOMINATOR,
        native_price_usd: 0,
    };

    // Check that the fee estimate is correct
    assert_eq(estimate, expected_estimate);
}

#[test]
#[fuzzer(runs: 10)]
fn should_deploy_with_price_ratio_denominator(
    owner: ContractAddress, price_updater: ContractAddress,
) {
    let PriceFeedDeploy { layer_zero, .. } = deploy_price_feed(owner, price_updater);
    assert_eq(layer_zero.get_price_ratio_denominator(), PRICE_RATIO_DENOMINATOR);
}

#[test]
fn should_set_native_price_usd_as_owner() {
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is the owner
    cheat_caller_address_once(price_feed, OWNER);
    dispatcher.set_native_price_usd(NATIVE_PRICE_USD);

    // Check that the native price usd is set correctly as the owner
    assert_eq(layer_zero.native_price_usd(), NATIVE_PRICE_USD);
}

#[test]
fn should_set_native_price_usd_as_updater() {
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is not the owner
    cheat_caller_address_once(price_feed, PRICE_UPDATER);
    dispatcher.set_native_price_usd(NATIVE_PRICE_USD);

    // Check that the native price usd is set correctly as the price updater
    assert_eq(layer_zero.native_price_usd(), NATIVE_PRICE_USD);
}

///////////////////////////////////////
// Set price ratio denominator tests //
///////////////////////////////////////

#[test]
fn should_set_price_ratio_denominator() {
    let PriceFeedDeploy {
        price_feed, dispatcher, layer_zero, ..,
    } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is the owner
    cheat_caller_address_once(price_feed, OWNER);
    dispatcher.set_price_ratio_denominator(PRICE_RATIO_DENOMINATOR);

    // Check that the price ratio denominator is set correctly
    assert_eq(layer_zero.get_price_ratio_denominator(), PRICE_RATIO_DENOMINATOR);
}

#[test]
#[feature("safe_dispatcher")]
fn should_fail_to_set_price_ratio_denominator_when_not_owner() {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is not the owner
    cheat_caller_address_once(price_feed, PRICE_UPDATER);
    let res = safe_dispatcher.set_price_ratio_denominator(PRICE_RATIO_DENOMINATOR);

    // Check that set_arbitrum_compression_percent panics with the expected error
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

#[test]
#[feature("safe_dispatcher")]
fn should_fail_to_set_price_ratio_denominator_when_zero() {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is the owner
    cheat_caller_address_once(price_feed, OWNER);
    let res = safe_dispatcher.set_price_ratio_denominator(0);

    // Check that set_arbitrum_compression_percent panics with the expected error
    assert_panic_with_error(res, err_price_ratio_denominator_zero());
}

#[test]
fn should_set_arbitrum_compression_percent() {
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is the owner
    cheat_caller_address_once(price_feed, OWNER);
    dispatcher.set_arbitrum_compression_percent(ARBITRUM_COMPRESSION_PERCENT);

    // Check that the arbitrum compression percent is set correctly
    assert_eq(dispatcher.get_arbitrum_compression_percent(), ARBITRUM_COMPRESSION_PERCENT);
}

#[test]
#[feature("safe_dispatcher")]
fn should_fail_to_set_arbitrum_compression_percent_when_not_owner() {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is not the owner
    cheat_caller_address_once(price_feed, PRICE_UPDATER);
    let res = safe_dispatcher.set_arbitrum_compression_percent(100);

    // Check that set_arbitrum_compression_percent panics with the expected error
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}


#[test]
fn should_set_endpoint() {
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is the owner
    cheat_caller_address_once(price_feed, OWNER);
    dispatcher.set_endpoint(ENDPOINT);

    // Check that the endpoint is set correctly
    assert_eq(dispatcher.get_endpoint(), ENDPOINT);
}

#[test]
#[feature("safe_dispatcher")]
fn should_fail_to_set_endpoint_when_not_owner() {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(OWNER, PRICE_UPDATER);

    // Caller is the owner
    cheat_caller_address_once(price_feed, PRICE_UPDATER);
    let res = safe_dispatcher.set_endpoint(ENDPOINT);

    // Check that the endpoint is set correctly
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
}

////////////////////////
// Withdraw fee tests //
////////////////////////

#[test]
#[fuzzer(runs: 10)]
fn should_withdraw_fee(owner: ContractAddress, price_updater: ContractAddress, amount: u256) {
    let PriceFeedDeploy { price_feed, dispatcher, .. } = deploy_price_feed(owner, price_updater);

    // Feed price feed with tokens
    let ERC20Mock { token, token_dispatcher } = deploy_mock_erc20(amount, price_feed);

    let mut spy = spy_events();

    // Owner withdraws fee
    cheat_caller_address_once(price_feed, owner);
    dispatcher.withdraw_fee(token, owner, amount);

    // Check that the fee is withdrawn correctly
    assert_eq(token_dispatcher.balance_of(owner), amount);
    assert_eq(token_dispatcher.balance_of(price_feed), 0);

    // Verify WithdrawFee event was emitted
    let price_feed_event = PriceFeedEvent::FeeWithdrawn(
        FeeWithdrawn { token_address: token, to: owner, amount: amount },
    );
    spy.assert_emitted(@array![(price_feed, price_feed_event)]);

    // Verify ERC20 transfer event was emitted
    let erc20_event = ERC20Event::Transfer(Transfer { from: price_feed, to: owner, value: amount });
    spy.assert_emitted(@array![(token, erc20_event)]);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_withdraw_fee_when_insufficient_balance(
    owner: ContractAddress,
    price_updater: ContractAddress,
    amount: u256,
    token_holder: ContractAddress,
) {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);

    // Feed price feed with 0 tokens
    let ERC20Mock { token, token_dispatcher } = deploy_mock_erc20(0, price_feed);

    // Owner tries to withdraw fee
    start_mock_call(token, selector!("transfer"), false);
    cheat_caller_address_once(price_feed, owner);
    let res = safe_dispatcher.withdraw_fee(token, owner, amount);

    // Check that the fee has not been withdrawn
    assert_panic_with_error(res, err_transfer_failed());
    assert_eq(token_dispatcher.balance_of(owner), 0);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_withdraw_fee_when_not_owner(
    owner: ContractAddress,
    not_owner: ContractAddress,
    price_updater: ContractAddress,
    amount: u256,
    token_holder: ContractAddress,
) {
    let PriceFeedDeploy {
        price_feed, safe_dispatcher, ..,
    } = deploy_price_feed(owner, price_updater);

    // Feed price feed with tokens
    let ERC20Mock { token, token_dispatcher } = deploy_mock_erc20(amount, price_feed);

    // Not owner tries to withdraw fee
    cheat_caller_address_once(price_feed, not_owner);
    let res = safe_dispatcher.withdraw_fee(token, not_owner, amount);

    // Check that the fee has not been withdrawn
    assert_panic_with_felt_error(res, OwnableComponent::Errors::NOT_OWNER);
    assert_eq(token_dispatcher.balance_of(price_feed), amount);
    assert_eq(token_dispatcher.balance_of(not_owner), 0);
}

//////////////////////////
// Implementation tests //
//////////////////////////

#[test]
fn impl_layer_zero_price_feed() {
    let PriceFeedDeploy { price_feed, .. } = deploy_price_feed(OWNER, PRICE_UPDATER);

    /// Runtime check that the price feed implements the ILayerZeroPriceFeed trait
    ILayerZeroPriceFeedDispatcher { contract_address: price_feed };
}
