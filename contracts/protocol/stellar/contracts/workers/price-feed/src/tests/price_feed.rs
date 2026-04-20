use super::setup::TestSetup;
use crate::errors::PriceFeedError;
use crate::types::{ArbitrumPriceExt, ModelType, SetEidToModelTypeParam, UpdatePrice, UpdatePriceExt};
use fee_lib_interfaces::Price;
use soroban_sdk::{testutils::Address as _, vec, Address};

// =============================================================================
// Construction
// =============================================================================

#[test]
fn test_constructor_sets_owner_and_price_updater() {
    let setup = TestSetup::new();

    assert_eq!(setup.client.owner(), Some(setup.owner.clone()));
    assert_eq!(setup.client.is_price_updater(&setup.price_updater), true);
}

#[test]
fn test_constructor_sets_default_values() {
    let setup = TestSetup::new();

    // Default price ratio denominator is 1e20
    assert_eq!(setup.client.get_price_ratio_denominator(), 10u128.pow(20));

    // Default Arbitrum compression percent is 47
    assert_eq!(setup.client.arbitrum_compression_percent(), 47);

    // Default native price USD is 0
    assert_eq!(setup.client.native_token_price_usd(), 0);

    // Default Arbitrum price ext
    let arb_ext = setup.client.arbitrum_price_ext();
    assert_eq!(arb_ext.gas_per_l2_tx, 0);
    assert_eq!(arb_ext.gas_per_l1_calldata_byte, 0);
}

// =============================================================================
// ILayerZeroPriceFeed (Trait Impl) - view fns
// =============================================================================

#[test]
fn test_get_price_returns_none_for_unconfigured_eid() {
    let setup = TestSetup::new();
    assert_eq!(setup.client.get_price(&999), None);
}

// =============================================================================
// ILayerZeroPriceFeed (Trait Impl) - estimate_fee_by_eid
// =============================================================================

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_estimate_fee_by_eid_requires_fee_lib_auth() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Set up price so only fee_lib.require_auth() can fail.
    let price = setup.default_test_price();
    setup.setup_default_price(1, &price);

    // No mock_auths for fee_lib.require_auth()
    setup.client.estimate_fee_by_eid(&fee_lib, &1, &100, &100_000);
}

#[test]
fn test_estimate_fee_by_eid_default_model() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Reference values:
    // - EID: 101
    // - calldata_size: 1000
    // - gas: 500
    let price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 1_000_000_000, gas_per_byte: 16 };
    setup.setup_default_price(101, &price);

    // Authorize fee_lib
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 101u32, 1000u32, 500u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &101, &1000, &500);

    // Expected fee (default model):
    // gas_for_calldata = calldata_size * gas_per_byte
    //               = 1000 * 16
    //               = 16_000
    // remote_fee = (gas_for_calldata + gas) * gas_price_in_unit
    //          = (16_000 + 500) * 1_000_000_000
    //          = 16_500 * 1_000_000_000
    //          = 16_500_000_000_000
    // fee = (remote_fee * price_ratio) / price_ratio_denominator
    //     = (16_500_000_000_000 * 1e20) / 1e20
    //     = 16_500_000_000_000

    assert_eq!(estimate.total_gas_fee, 16_500_000_000_000 as i128);
    assert_eq!(estimate.price_ratio, price.price_ratio);
    assert_eq!(estimate.price_ratio_denominator, 10u128.pow(20));
    assert_eq!(estimate.native_price_usd, 0);
}

#[test]
fn test_estimate_fee_by_eid_includes_native_price_usd_and_denominator() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Change denominator from the default and ensure it's reflected in FeeEstimate.
    let denom = 10u128.pow(18);
    setup.mock_owner_auth("set_price_ratio_denominator", (denom,));
    setup.client.set_price_ratio_denominator(&denom);

    // Set native token USD price and ensure it's reflected in FeeEstimate.
    let price_usd = 1234 * 10u128.pow(18);
    setup.mock_price_updater_auth("set_native_token_price_usd", (&setup.price_updater, price_usd));
    setup.client.set_native_token_price_usd(&setup.price_updater, &price_usd);

    // Use price_ratio == denom so fee math stays 1:1 and easy to validate.
    let price = Price { price_ratio: denom, gas_price_in_unit: 1_000_000, gas_per_byte: 16 };
    setup.setup_default_price(1, &price);

    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 1u32, 10u32, 1_000u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &1, &10, &1_000);

    assert_eq!(estimate.price_ratio_denominator, denom);
    assert_eq!(estimate.native_price_usd, price_usd);
}

#[test]
fn test_estimate_fee_by_eid_with_different_price_ratio() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Set up price with 2:1 price ratio (destination token worth 2x source token)
    let price = Price {
        price_ratio: 2 * 10u128.pow(20), // 2x ratio
        gas_price_in_unit: 1_000_000,
        gas_per_byte: 16,
    };
    setup.setup_default_price(1, &price);

    // Authorize fee_lib
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 1u32, 100u32, 100_000u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &1, &100, &100_000);

    // Fee should be 2x compared to 1:1 ratio:
    // gas_for_calldata = calldata_size * gas_per_byte
    //               = 100 * 16
    //               = 1_600
    // remote_fee = (gas_for_calldata + gas) * gas_price_in_unit
    //          = (1_600 + 100_000) * 1_000_000
    //          = 101_600 * 1_000_000
    //          = 101_600_000_000
    // fee = (remote_fee * price_ratio) / price_ratio_denominator
    //     = (101_600_000_000 * (2 * 1e20)) / 1e20
    //     = 203_200_000_000
    let gas_for_calldata = 100u128 * 16;
    let remote_fee = (gas_for_calldata + 100_000) * 1_000_000;
    let expected_fee = (remote_fee * price.price_ratio) / 10u128.pow(20);

    assert_eq!(estimate.total_gas_fee, expected_fee as i128);
    assert_eq!(estimate.price_ratio, price.price_ratio);
}

#[test]
fn test_estimate_fee_by_eid_rejects_missing_price() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // No price set for EID 999
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 999u32, 100u32, 100_000u128));
    assert_eq!(
        setup.client.try_estimate_fee_by_eid(&fee_lib, &999, &100, &100_000).unwrap_err().unwrap(),
        PriceFeedError::NoPrice.into()
    );
}

// =============================================================================
// ILayerZeroPriceFeed - estimate_fee_by_eid (Arbitrum Model)
// =============================================================================

#[test]
fn test_estimate_fee_by_eid_arbitrum_model_hardcoded_eid() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // EID 110 is hardcoded as Arbitrum
    let arb_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 10_000_000, gas_per_byte: 16 };
    setup.setup_default_price(110, &arb_price);

    // Set Arbitrum-specific parameters
    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 4176, gas_per_l1_calldata_byte: 29 };
    let update = UpdatePriceExt { eid: 110, price: arb_price.clone(), extend: arb_ext.clone() };
    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &update));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &update);

    // Authorize fee_lib
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 110u32, 1000u32, 500u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &110, &1000, &500);

    // Expected fee (Arbitrum model):
    // compressed_size = floor(calldata_size * compression_percent / 100)
    //               = floor((1000 * 47) / 100)
    //               = floor(470)
    //               = 470
    // l1_calldata_gas = compressed_size * gas_per_l1_calldata_byte
    //                = 470 * 29
    //                = 13_630
    // l2_calldata_gas = calldata_size * gas_per_byte
    //                = 1000 * 16
    //                = 16_000
    // total_gas = gas + gas_per_l2_tx + l1_calldata_gas + l2_calldata_gas
    //          = 500 + 4_176 + 13_630 + 16_000
    //          = 34_306
    // fee = (total_gas * gas_price_in_unit * price_ratio) / price_ratio_denominator
    //     = (34_306 * 10_000_000 * 1e20) / 1e20
    //     = 34_306 * 10_000_000
    //     = 343_060_000_000

    assert_eq!(estimate.total_gas_fee, 343_060_000_000 as i128);

    assert_eq!(estimate.price_ratio, arb_price.price_ratio);
}

#[test]
fn test_estimate_fee_by_eid_arbitrum_model_hardcoded_eid_10143() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // EID 10143 is hardcoded as Arbitrum (same model selection path as 110).
    // Use the same inputs as `test_estimate_fee_by_eid_arbitrum_model_hardcoded_eid`
    // so the computed fee should be identical.
    let arb_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 10_000_000, gas_per_byte: 16 };

    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 4176, gas_per_l1_calldata_byte: 29 };
    let update = UpdatePriceExt { eid: 10143, price: arb_price.clone(), extend: arb_ext };
    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &update));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &update);

    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 10143u32, 1000u32, 500u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &10143, &1000, &500);

    assert_eq!(estimate.total_gas_fee, 343_060_000_000 as i128);
    assert_eq!(estimate.price_ratio, arb_price.price_ratio);
}

#[test]
fn test_estimate_fee_by_eid_arbitrum_model_uses_updated_compression_percent() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Choose parameters so fee is driven purely by compression percent.
    // gas=0, gas_per_l2_tx=0, gas_per_byte=0, gas_price_in_unit=1
    let denom = setup.client.get_price_ratio_denominator();
    let arb_price = Price { price_ratio: denom, gas_price_in_unit: 1, gas_per_byte: 0 };
    setup.setup_default_price(110, &arb_price);

    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 0, gas_per_l1_calldata_byte: 100 };
    let update = UpdatePriceExt { eid: 110, price: arb_price.clone(), extend: arb_ext };
    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &update));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &update);

    // compression=0 => L1 calldata fee is 0 => total fee is 0
    setup.mock_owner_auth("set_arbitrum_compression_percent", (0u128,));
    setup.client.set_arbitrum_compression_percent(&0u128);
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 110u32, 100u32, 0u128));
    let est0 = setup.client.estimate_fee_by_eid(&fee_lib, &110, &100, &0);
    assert_eq!(est0.total_gas_fee, 0);

    // compression=100 => L1 calldata gas = (100 * 100 / 100) * 100 = 10_000
    setup.mock_owner_auth("set_arbitrum_compression_percent", (100u128,));
    setup.client.set_arbitrum_compression_percent(&100u128);
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 110u32, 100u32, 0u128));
    let est100 = setup.client.estimate_fee_by_eid(&fee_lib, &110, &100, &0);
    assert_eq!(est100.total_gas_fee, 10_000);
}

#[test]
fn test_estimate_fee_by_eid_arbitrum_model_configured_eid() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Configure EID 200 as ArbStack
    let params = vec![&setup.env, SetEidToModelTypeParam { dst_eid: 200, model_type: ModelType::ArbStack }];
    setup.mock_owner_auth("set_eid_to_model_type", (&params,));
    setup.client.set_eid_to_model_type(&params);

    // Set price for EID 200
    // Use the same parameters as `test_estimate_fee_by_eid_arbitrum_model_hardcoded_eid`
    // so the expected fee is deterministic and validates the Arbitrum-model math path.
    let arb_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 10_000_000, gas_per_byte: 16 };
    setup.setup_default_price(200, &arb_price);

    // Set Arbitrum-specific parameters
    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 4176, gas_per_l1_calldata_byte: 29 };
    let update = UpdatePriceExt { eid: 200, price: arb_price.clone(), extend: arb_ext };
    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &update));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &update);

    // Authorize fee_lib
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 200u32, 1000u32, 500u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &200, &1000, &500);

    // Should use Arbitrum model (same expected fee as the hardcoded Arbitrum test)
    assert_eq!(estimate.total_gas_fee, 343_060_000_000 as i128);
    assert_eq!(estimate.price_ratio, arb_price.price_ratio);
}

// =============================================================================
// ILayerZeroPriceFeed - estimate_fee_by_eid (Optimism Model)
// =============================================================================

#[test]
fn test_estimate_fee_by_eid_optimism_model_hardcoded_eid() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // EID 111 is hardcoded as Optimism
    // Need to set up both L1 (Ethereum) and L2 (Optimism) prices

    let eth_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 646_718_991, gas_per_byte: 8 };
    setup.setup_default_price(101, &eth_price);

    // Optimism price
    let op_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 2_231_118, gas_per_byte: 16 };
    setup.setup_default_price(111, &op_price);

    // Authorize fee_lib
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 111u32, 1000u32, 500u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &111, &1000, &500);

    // Expected fee (Optimism model):
    // l1_fee = ((calldata_size * eth_gas_per_byte) + 3188) * eth_gas_price
    //       = ((1000 * 8) + 3188) * 646_718_991
    //       = (8_000 + 3_188) * 646_718_991
    //       = 11_188 * 646_718_991
    //       = 7_235_492_071_308
    // l2_fee = ((calldata_size * op_gas_per_byte) + gas) * op_gas_price
    //       = ((1000 * 16) + 500) * 2_231_118
    //       = (16_000 + 500) * 2_231_118
    //       = 16_500 * 2_231_118
    //       = 36_813_447_000
    // total_fee = (l1_fee * eth_price_ratio / denom) + (l2_fee * op_price_ratio / denom)
    //          = (7_235_492_071_308 * 1e20 / 1e20) + (36_813_447_000 * 1e20 / 1e20)
    //          = 7_235_492_071_308 + 36_813_447_000
    //          = 7_272_305_518_308

    assert_eq!(estimate.total_gas_fee, 7_272_305_518_308 as i128);
    assert_eq!(estimate.price_ratio, op_price.price_ratio);
}

#[test]
fn test_estimate_fee_by_eid_optimism_model_goerli() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // EID 10132 is hardcoded as Optimism Goerli
    // L1 lookup should be 10121 (Ethereum Goerli)

    // Ethereum Goerli price
    let eth_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 646_718_991, gas_per_byte: 8 };
    setup.setup_default_price(10121, &eth_price);

    // Optimism Goerli price
    let op_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 2_231_118, gas_per_byte: 16 };
    setup.setup_default_price(10132, &op_price);

    // Authorize fee_lib
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 10132u32, 1000u32, 500u128));
    let estimate = setup.client.estimate_fee_by_eid(&fee_lib, &10132, &1000, &500);

    // Deterministic expected fee (Optimism model):
    // L1 uses Ethereum Goerli (10121) with +3188 overhead, L2 uses Optimism Goerli (10132).
    assert_eq!(estimate.total_gas_fee, 7_272_305_518_308 as i128);
    assert_eq!(estimate.price_ratio, op_price.price_ratio);
}
#[test]
fn test_estimate_fee_by_eid_optimism_model_configured_eid() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Configure EID 300 as OpStack
    let params = vec![&setup.env, SetEidToModelTypeParam { dst_eid: 300, model_type: ModelType::OpStack }];
    setup.mock_owner_auth("set_eid_to_model_type", (&params,));
    setup.client.set_eid_to_model_type(&params);

    // Set up Ethereum price (EID 101 used for mainnet L1 lookup)
    let eth_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 646_718_991, gas_per_byte: 8 };
    setup.setup_default_price(101, &eth_price);

    // Set up Optimism price for EID 300
    let op_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 2_231_118, gas_per_byte: 16 };
    setup.setup_default_price(300, &op_price);

    // Compare configured OpStack EID (300) to hardcoded Optimism EID (111).
    // With identical L1/L2 prices and inputs, the fee must match if we are on the Optimism path.
    setup.setup_default_price(111, &op_price);

    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 300u32, 1000u32, 500u128));
    let estimate_300 = setup.client.estimate_fee_by_eid(&fee_lib, &300, &1000, &500);

    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 111u32, 1000u32, 500u128));
    let estimate_111 = setup.client.estimate_fee_by_eid(&fee_lib, &111, &1000, &500);

    assert_eq!(estimate_300.total_gas_fee, estimate_111.total_gas_fee);
    assert_eq!(estimate_300.price_ratio, estimate_111.price_ratio);
    assert_eq!(estimate_300.price_ratio, op_price.price_ratio);
    assert_eq!(estimate_300.total_gas_fee, 7_272_305_518_308 as i128);
}

#[test]
fn test_estimate_fee_by_eid_uses_modulo_for_model_type_and_price_lookup_non_hardcoded() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Pick a non-hardcoded EID so the "configured model type" branch is used.
    // 42_345 % 30_000 == 12_345.
    let base_eid: u32 = 12_345;
    let dst_eid: u32 = 42_345;

    // Configure base EID as OpStack.
    let params = vec![&setup.env, SetEidToModelTypeParam { dst_eid: base_eid, model_type: ModelType::OpStack }];
    setup.mock_owner_auth("set_eid_to_model_type", (&params,));
    setup.client.set_eid_to_model_type(&params);

    // For 12_345 (>= 10_000 and < 20_000), L1 lookup id is 10_161 per contract logic.
    let l1_lookup: u32 = 10_161;
    let eth_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 10_000_000_000, gas_per_byte: 16 };
    setup.setup_default_price(l1_lookup, &eth_price);

    // L2 price for base_eid (the modulo'd EID that gets used for lookup).
    let l2_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 1_000_000, gas_per_byte: 16 };
    setup.setup_default_price(base_eid, &l2_price);

    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, dst_eid, 100u32, 100_000u128));
    let estimate_dst = setup.client.estimate_fee_by_eid(&fee_lib, &dst_eid, &100, &100_000);

    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, base_eid, 100u32, 100_000u128));
    let estimate_base = setup.client.estimate_fee_by_eid(&fee_lib, &base_eid, &100, &100_000);

    // The contract reduces dst_eid modulo 30_000 before model selection and price lookup.
    assert_eq!(estimate_dst.total_gas_fee, estimate_base.total_gas_fee);
    assert_eq!(estimate_dst.price_ratio, estimate_base.price_ratio);
    assert_eq!(estimate_dst.price_ratio, l2_price.price_ratio);
}

// =============================================================================
// ILayerZeroPriceFeed - estimate_fee_by_eid (EID modulo 30000)
// =============================================================================

#[test]
fn test_estimate_fee_by_eid_modulo_30000() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // EID 30110 is treated as 110 (Arbitrum) after modulo 30000
    // The price lookup uses the modulo'd EID (110), so we set price for EID 110
    let arb_price = Price { price_ratio: 10u128.pow(20), gas_price_in_unit: 100_000, gas_per_byte: 8 };
    setup.setup_default_price(110, &arb_price);

    // Set Arbitrum-specific parameters (stored globally, not per-EID)
    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 50_000, gas_per_l1_calldata_byte: 16 };
    let update = UpdatePriceExt { eid: 110, price: arb_price.clone(), extend: arb_ext };
    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &update));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &update);

    // Authorize fee_lib for EID 30110 (the original EID in the call)
    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 30110u32, 100u32, 100_000u128));
    let estimate_30110 = setup.client.estimate_fee_by_eid(&fee_lib, &30110, &100, &100_000);

    setup.mock_auth(&fee_lib, "estimate_fee_by_eid", (&fee_lib, 110u32, 100u32, 100_000u128));
    let estimate_110 = setup.client.estimate_fee_by_eid(&fee_lib, &110, &100, &100_000);

    // Should use Arbitrum model because 30110 % 30000 = 110
    assert_eq!(estimate_30110.total_gas_fee, estimate_110.total_gas_fee);
    assert_eq!(estimate_30110.price_ratio, estimate_110.price_ratio);
    assert_eq!(estimate_30110.price_ratio, arb_price.price_ratio);
}

#[test]
fn test_estimate_fee_by_eid_rejects_when_fee_exceeds_i128_max() {
    let setup = TestSetup::new();
    let fee_lib = Address::generate(&setup.env);

    // Avoid auth-mock brittleness for this pure arithmetic/overflow test.
    setup.env.mock_all_auths();

    // Use denominator=1 and price_ratio=1 so we avoid u128 overflow in
    // `remote_fee * price_ratio` while still being able to exceed i128::MAX.
    setup.client.set_price_ratio_denominator(&1u128);

    let price = Price { price_ratio: 1u128, gas_price_in_unit: 1u64, gas_per_byte: 0 };
    let prices = vec![&setup.env, UpdatePrice { eid: 1, price: price.clone() }];
    setup.client.set_price(&setup.price_updater, &prices);

    // With calldata_size=0 and gas_per_byte=0:
    // remote_fee = gas * 1 == gas, and fee == remote_fee (since denom=1, ratio=1).
    let gas: u128 = (i128::MAX as u128) + 1;
    assert_eq!(
        setup.client.try_estimate_fee_by_eid(&fee_lib, &1, &0, &gas).unwrap_err().unwrap(),
        PriceFeedError::Overflow.into()
    );
}

// =============================================================================
// Owner Functions
// =============================================================================

#[test]
fn test_set_price_updater_add_and_remove() {
    let setup = TestSetup::new();
    let new_updater = Address::generate(&setup.env);

    // Add new price updater
    setup.mock_owner_auth("set_price_updater", (&new_updater, true));
    setup.client.set_price_updater(&new_updater, &true);
    assert_eq!(setup.client.is_price_updater(&new_updater), true);

    // Remove price updater
    setup.mock_owner_auth("set_price_updater", (&new_updater, false));
    setup.client.set_price_updater(&new_updater, &false);
    assert_eq!(setup.client.is_price_updater(&new_updater), false);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_price_updater_requires_owner_auth() {
    let setup = TestSetup::new();
    let new_updater = Address::generate(&setup.env);

    // No mock_auths -> owner.require_auth() must fail
    setup.client.set_price_updater(&new_updater, &true);
}

#[test]
fn test_set_price_ratio_denominator_success() {
    let setup = TestSetup::new();
    let new_denominator = 100_000_000u128;

    setup.mock_owner_auth("set_price_ratio_denominator", (new_denominator,));
    setup.client.set_price_ratio_denominator(&new_denominator);

    assert_eq!(setup.client.get_price_ratio_denominator(), new_denominator);
}

#[test]
fn test_set_price_ratio_denominator_rejects_zero() {
    let setup = TestSetup::new();

    setup.mock_owner_auth("set_price_ratio_denominator", (0u128,));
    assert_eq!(
        setup.client.try_set_price_ratio_denominator(&0).unwrap_err().unwrap(),
        PriceFeedError::InvalidDenominator.into()
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_price_ratio_denominator_requires_owner_auth() {
    let setup = TestSetup::new();
    let new_denominator = 10u128.pow(18);

    // No mock_auths
    setup.client.set_price_ratio_denominator(&new_denominator);
}

#[test]
fn test_set_arbitrum_compression_percent_success() {
    let setup = TestSetup::new();
    let new_percent = 50u128;

    setup.mock_owner_auth("set_arbitrum_compression_percent", (new_percent,));
    setup.client.set_arbitrum_compression_percent(&new_percent);

    assert_eq!(setup.client.arbitrum_compression_percent(), new_percent);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_arbitrum_compression_percent_requires_owner_auth() {
    let setup = TestSetup::new();
    let new_percent = 50u128;

    // No mock_auths
    setup.client.set_arbitrum_compression_percent(&new_percent);
}

#[test]
fn test_set_eid_to_model_type_success() {
    let setup = TestSetup::new();

    let params = vec![
        &setup.env,
        SetEidToModelTypeParam { dst_eid: 100, model_type: ModelType::OpStack },
        SetEidToModelTypeParam { dst_eid: 200, model_type: ModelType::ArbStack },
    ];

    setup.mock_owner_auth("set_eid_to_model_type", (&params,));
    setup.client.set_eid_to_model_type(&params);

    assert_eq!(setup.client.eid_to_model_type(&100), ModelType::OpStack);
    assert_eq!(setup.client.eid_to_model_type(&200), ModelType::ArbStack);
    // Unconfigured EID returns Default
    assert_eq!(setup.client.eid_to_model_type(&300), ModelType::Default);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_eid_to_model_type_requires_owner_auth() {
    let setup = TestSetup::new();

    let params = vec![&setup.env, SetEidToModelTypeParam { dst_eid: 100, model_type: ModelType::OpStack }];

    // No mock_auths
    setup.client.set_eid_to_model_type(&params);
}

// =============================================================================
// Price Updater Functions
// =============================================================================

#[test]
fn test_set_price_with_price_updater() {
    let setup = TestSetup::new();

    let price = setup.new_price(10u128.pow(20), 1_000_000, 16);
    let prices = vec![&setup.env, UpdatePrice { eid: 1, price: price.clone() }];

    setup.mock_price_updater_auth("set_price", (&setup.price_updater, &prices));
    setup.client.set_price(&setup.price_updater, &prices);

    assert_eq!(setup.client.get_price(&1), Some(price));
}

#[test]
fn test_set_price_with_owner() {
    let setup = TestSetup::new();

    let price = setup.new_price(10u128.pow(20), 2_000_000, 32);
    let prices = vec![&setup.env, UpdatePrice { eid: 2, price: price.clone() }];

    // Owner can also set prices
    setup.mock_owner_auth("set_price", (&setup.owner, &prices));
    setup.client.set_price(&setup.owner, &prices);

    assert_eq!(setup.client.get_price(&2), Some(price));
}

#[test]
fn test_set_price_multiple_eids() {
    let setup = TestSetup::new();

    let price1 = setup.new_price(10u128.pow(20), 1_000_000_000, 16);
    let price2 = setup.new_price(2 * 10u128.pow(20), 2_000_000_000, 32);
    let prices = vec![
        &setup.env,
        UpdatePrice { eid: 101, price: price1.clone() },
        UpdatePrice { eid: 102, price: price2.clone() },
    ];

    setup.mock_price_updater_auth("set_price", (&setup.price_updater, &prices));
    setup.client.set_price(&setup.price_updater, &prices);

    assert_eq!(setup.client.get_price(&101), Some(price1));
    assert_eq!(setup.client.get_price(&102), Some(price2));
}

#[test]
fn test_set_price_rejects_non_price_updater() {
    let setup = TestSetup::new();

    let non_updater = Address::generate(&setup.env);
    let price = setup.default_test_price();
    let prices = vec![&setup.env, UpdatePrice { eid: 1, price }];

    setup.mock_auth(&non_updater, "set_price", (&non_updater, &prices));
    assert_eq!(
        setup.client.try_set_price(&non_updater, &prices).unwrap_err().unwrap(),
        PriceFeedError::OnlyPriceUpdater.into()
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_price_requires_caller_auth_even_if_price_updater() {
    let setup = TestSetup::new();

    let price = setup.default_test_price();
    let prices = vec![&setup.env, UpdatePrice { eid: 1, price }];

    // price_updater is active, but no mock_auths -> caller.require_auth() must fail.
    setup.client.set_price(&setup.price_updater, &prices);
}

#[test]
fn test_set_price_for_arbitrum_success() {
    let setup = TestSetup::new();

    let price = setup.new_price(10u128.pow(20), 500_000, 8);
    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 100_000, gas_per_l1_calldata_byte: 16 };
    let update = UpdatePriceExt { eid: 110, price: price.clone(), extend: arb_ext.clone() };

    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &update));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &update);

    assert_eq!(setup.client.get_price(&110), Some(price));
    assert_eq!(setup.client.arbitrum_price_ext(), arb_ext);
}

#[test]
fn test_set_price_for_arbitrum_overwrites_arbitrum_price_ext() {
    let setup = TestSetup::new();

    let price = setup.default_test_price();
    let ext1 = ArbitrumPriceExt { gas_per_l2_tx: 1, gas_per_l1_calldata_byte: 2 };
    let upd1 = UpdatePriceExt { eid: 110, price: price.clone(), extend: ext1.clone() };
    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &upd1));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &upd1);
    assert_eq!(setup.client.arbitrum_price_ext(), ext1);

    let ext2 = ArbitrumPriceExt { gas_per_l2_tx: 999, gas_per_l1_calldata_byte: 888 };
    let upd2 = UpdatePriceExt { eid: 110, price, extend: ext2.clone() };
    setup.mock_price_updater_auth("set_price_for_arbitrum", (&setup.price_updater, &upd2));
    setup.client.set_price_for_arbitrum(&setup.price_updater, &upd2);
    assert_eq!(setup.client.arbitrum_price_ext(), ext2);
}

#[test]
fn test_set_price_for_arbitrum_rejects_non_price_updater() {
    let setup = TestSetup::new();

    let non_updater = Address::generate(&setup.env);
    let price = setup.default_test_price();
    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 100_000, gas_per_l1_calldata_byte: 16 };
    let update = UpdatePriceExt { eid: 110, price, extend: arb_ext };

    setup.mock_auth(&non_updater, "set_price_for_arbitrum", (&non_updater, &update));
    assert_eq!(
        setup.client.try_set_price_for_arbitrum(&non_updater, &update).unwrap_err().unwrap(),
        PriceFeedError::OnlyPriceUpdater.into()
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_price_for_arbitrum_requires_caller_auth_even_if_price_updater() {
    let setup = TestSetup::new();

    let price = setup.default_test_price();
    let arb_ext = ArbitrumPriceExt { gas_per_l2_tx: 100_000, gas_per_l1_calldata_byte: 16 };
    let update = UpdatePriceExt { eid: 110, price, extend: arb_ext };

    // price_updater is active, but no mock_auths -> caller.require_auth() must fail.
    setup.client.set_price_for_arbitrum(&setup.price_updater, &update);
}

#[test]
fn test_set_native_token_price_usd_success() {
    let setup = TestSetup::new();
    let price_usd = 2500 * 10u128.pow(18); // $2500 scaled

    setup.mock_price_updater_auth("set_native_token_price_usd", (&setup.price_updater, price_usd));
    setup.client.set_native_token_price_usd(&setup.price_updater, &price_usd);

    assert_eq!(setup.client.native_token_price_usd(), price_usd);
}

#[test]
fn test_set_native_token_price_usd_with_owner() {
    let setup = TestSetup::new();
    let price_usd = 3000 * 10u128.pow(18);

    setup.mock_owner_auth("set_native_token_price_usd", (&setup.owner, price_usd));
    setup.client.set_native_token_price_usd(&setup.owner, &price_usd);

    assert_eq!(setup.client.native_token_price_usd(), price_usd);
}

#[test]
fn test_set_native_token_price_usd_rejects_non_price_updater() {
    let setup = TestSetup::new();

    let non_updater = Address::generate(&setup.env);
    let price_usd = 2500 * 10u128.pow(18);

    setup.mock_auth(&non_updater, "set_native_token_price_usd", (&non_updater, price_usd));
    assert_eq!(
        setup.client.try_set_native_token_price_usd(&non_updater, &price_usd).unwrap_err().unwrap(),
        PriceFeedError::OnlyPriceUpdater.into()
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_native_token_price_usd_requires_caller_auth_even_if_price_updater() {
    let setup = TestSetup::new();
    let price_usd = 2500 * 10u128.pow(18);

    // price_updater is active, but no mock_auths -> caller.require_auth() must fail.
    setup.client.set_native_token_price_usd(&setup.price_updater, &price_usd);
}

// =============================================================================
// View Functions
// =============================================================================

#[test]
fn test_is_price_updater_returns_false_for_unknown_address() {
    let setup = TestSetup::new();
    let unknown = Address::generate(&setup.env);

    assert_eq!(setup.client.is_price_updater(&unknown), false);
}

// =============================================================================
// Edge Cases
// =============================================================================

#[test]
fn test_price_update_overwrites_previous() {
    let setup = TestSetup::new();

    let price1 = setup.new_price(10u128.pow(20), 1_000_000, 16);
    setup.setup_default_price(1, &price1);
    assert_eq!(setup.client.get_price(&1), Some(price1));

    // Update to new price
    let price2 = setup.new_price(2 * 10u128.pow(20), 2_000_000, 32);
    setup.setup_default_price(1, &price2);
    assert_eq!(setup.client.get_price(&1), Some(price2));
}

#[test]
fn test_multiple_price_updaters() {
    let setup = TestSetup::new();

    // Add a second price updater
    let updater2 = Address::generate(&setup.env);
    setup.mock_owner_auth("set_price_updater", (&updater2, true));
    setup.client.set_price_updater(&updater2, &true);

    // Both updaters should be able to set prices
    let price1 = setup.new_price(10u128.pow(20), 1_000_000, 16);
    let prices1 = vec![&setup.env, UpdatePrice { eid: 1, price: price1.clone() }];
    setup.mock_price_updater_auth("set_price", (&setup.price_updater, &prices1));
    setup.client.set_price(&setup.price_updater, &prices1);
    assert_eq!(setup.client.get_price(&1), Some(price1));

    let price2 = setup.new_price(2 * 10u128.pow(20), 2_000_000, 32);
    let prices2 = vec![&setup.env, UpdatePrice { eid: 2, price: price2.clone() }];
    setup.mock_auth(&updater2, "set_price", (&updater2, &prices2));
    setup.client.set_price(&updater2, &prices2);
    assert_eq!(setup.client.get_price(&2), Some(price2));
}

#[test]
fn test_removed_price_updater_cannot_set_price() {
    let setup = TestSetup::new();

    // Remove the price updater
    setup.mock_owner_auth("set_price_updater", (&setup.price_updater, false));
    setup.client.set_price_updater(&setup.price_updater, &false);

    // Try to set price - should fail
    let price = setup.default_test_price();
    let prices = vec![&setup.env, UpdatePrice { eid: 1, price }];
    setup.mock_price_updater_auth("set_price", (&setup.price_updater, &prices));
    assert_eq!(
        setup.client.try_set_price(&setup.price_updater, &prices).unwrap_err().unwrap(),
        PriceFeedError::OnlyPriceUpdater.into()
    );
}
