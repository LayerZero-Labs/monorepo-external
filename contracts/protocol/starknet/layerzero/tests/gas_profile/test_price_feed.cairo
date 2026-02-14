use layerzero::workers::price_feed::interface::{IPriceFeedDispatcher, IPriceFeedDispatcherTrait};
use layerzero::workers::price_feed::structs::{
    ArbitrumPriceExt, Price, SetPriceParam, UpdatePriceExt,
};
use lz_utils::bytes::ContractAddressIntoBytes32;
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::e2e;
use crate::gas_profile::utils::{PRICE_FEED_OWNER, REMOTE_EID};

const PRICE: Price = Price { gas_per_byte: 42, gas_price_in_unit: 42, price_ratio: 42 };

fn deploy_price_feed() -> IPriceFeedDispatcher {
    let contract_address = e2e::utils::deploy_price_feed(PRICE_FEED_OWNER, REMOTE_EID);

    IPriceFeedDispatcher { contract_address }
}

#[test]
fn test_set_price() {
    let price_feed = deploy_price_feed();

    cheat_caller_address_once(price_feed.contract_address, PRICE_FEED_OWNER);
    price_feed.set_price(array![SetPriceParam { eid: REMOTE_EID, price: PRICE }]);
}

#[test]
fn test_set_price_for_arbitrum() {
    let price_feed = deploy_price_feed();

    cheat_caller_address_once(price_feed.contract_address, PRICE_FEED_OWNER);
    price_feed
        .set_price_for_arbitrum(
            UpdatePriceExt {
                eid: REMOTE_EID,
                price: PRICE,
                extend: ArbitrumPriceExt { gas_per_l2_tx: 42, gas_per_l1_call_data_byte: 42 },
            },
        );
}

#[test]
fn test_set_native_price_usd() {
    let price_feed = deploy_price_feed();

    cheat_caller_address_once(price_feed.contract_address, PRICE_FEED_OWNER);
    price_feed.set_native_price_usd(42);
}
