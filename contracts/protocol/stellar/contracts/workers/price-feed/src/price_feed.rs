use common_macros::{contract_impl, lz_contract, only_auth};
use fee_lib_interfaces::{FeeEstimate, ILayerZeroPriceFeed, Price};
use soroban_sdk::{assert_with_error, Address, Env, Vec};
use utils::option_ext::OptionExt;

use crate::{
    errors::PriceFeedError,
    events::{ArbitrumPriceExtUpdated, PriceUpdated, PriceUpdaterSet},
    storage::PriceFeedStorage,
    types::{ArbitrumPriceExt, ModelType, SetEidToModelTypeParam, UpdatePrice, UpdatePriceExt},
};

#[lz_contract(upgradeable(no_migration))]
pub struct LzPriceFeed;

#[contract_impl]
impl LzPriceFeed {
    pub fn __constructor(env: &Env, owner: &Address, price_updater: &Address) {
        Self::init_owner(env, owner);

        PriceFeedStorage::set_price_updater(env, price_updater, &true);
    }
}

#[contract_impl]
impl ILayerZeroPriceFeed for LzPriceFeed {
    /// Estimate fee with detailed breakdown by endpoint ID
    /// Corresponds to estimateFeeByEid in PriceFeed.sol
    fn estimate_fee_by_eid(env: &Env, fee_lib: &Address, dst_eid: u32, calldata_size: u32, gas: u128) -> FeeEstimate {
        fee_lib.require_auth();

        let eid = dst_eid % 30_000;

        let (fee, price_ratio) = if eid == 110 || eid == 10143 || eid == 20143 {
            Self::estimate_fee_with_arbitrum_model(env, eid, calldata_size, gas)
        } else if eid == 111 || eid == 10132 || eid == 20132 {
            Self::estimate_fee_with_optimism_model(env, eid, calldata_size, gas)
        } else {
            // Check configured model type
            let model_type = Self::eid_to_model_type(env, eid);
            match model_type {
                ModelType::OpStack => Self::estimate_fee_with_optimism_model(env, eid, calldata_size, gas),
                ModelType::ArbStack => Self::estimate_fee_with_arbitrum_model(env, eid, calldata_size, gas),
                ModelType::Default => Self::estimate_fee_with_default_model(env, eid, calldata_size, gas),
            }
        };

        let price_ratio_denominator = Self::get_price_ratio_denominator(env);
        let native_price_usd = Self::native_token_price_usd(env);

        assert_with_error!(env, fee <= i128::MAX as u128, PriceFeedError::Overflow);

        FeeEstimate { total_gas_fee: fee as i128, price_ratio, price_ratio_denominator, native_price_usd }
    }

    /// Get the native token price in USD
    fn native_token_price_usd(env: &Env) -> u128 {
        PriceFeedStorage::native_price_usd(env)
    }

    /// Get the price for a destination EID.
    fn get_price(env: &Env, dst_eid: u32) -> Option<Price> {
        PriceFeedStorage::default_model_price(env, dst_eid)
    }

    /// Get the price ratio denominator.
    fn get_price_ratio_denominator(env: &Env) -> u128 {
        PriceFeedStorage::price_ratio_denominator(env)
    }
}

#[contract_impl]
impl LzPriceFeed {
    // ========================================================================
    // Owner Functions
    // ========================================================================

    /// Set price updater status (owner only)
    #[only_auth]
    pub fn set_price_updater(env: &Env, updater: &Address, active: bool) {
        if active {
            PriceFeedStorage::set_price_updater(env, updater, &true);
        } else {
            PriceFeedStorage::remove_price_updater(env, updater);
        }
        PriceUpdaterSet { updater: updater.clone(), active }.publish(env);
    }

    /// Set the price ratio denominator (owner only)
    #[only_auth]
    pub fn set_price_ratio_denominator(env: &Env, denominator: u128) {
        assert_with_error!(env, denominator > 0, PriceFeedError::InvalidDenominator);
        PriceFeedStorage::set_price_ratio_denominator(env, &denominator);
    }

    /// Set the Arbitrum compression percentage (owner only)
    #[only_auth]
    pub fn set_arbitrum_compression_percent(env: &Env, compression_percent: u128) {
        PriceFeedStorage::set_arbitrum_compression_percent(env, &compression_percent);
    }

    /// Set the fee model type for destination EIDs (owner only)
    #[only_auth]
    pub fn set_eid_to_model_type(env: &Env, params: &Vec<SetEidToModelTypeParam>) {
        params.iter().for_each(|param| PriceFeedStorage::set_eid_to_model_type(env, param.dst_eid, &param.model_type));
    }

    // ========================================================================
    // Price Updater Functions
    // ========================================================================

    /// Set prices for multiple destinations (price updater or owner)
    pub fn set_price(env: &Env, price_updater: &Address, prices: &Vec<UpdatePrice>) {
        Self::require_owner_or_price_updater(env, price_updater);

        prices.iter().for_each(|update| Self::set_price_internal(env, update.eid, &update.price));
    }

    /// Set price for Arbitrum with extension (price updater or owner)
    /// Corresponds to setPriceForArbitrum in PriceFeed.sol
    pub fn set_price_for_arbitrum(env: &Env, price_updater: &Address, update: &UpdatePriceExt) {
        Self::require_owner_or_price_updater(env, price_updater);

        Self::set_price_internal(env, update.eid, &update.price);

        // Update Arbitrum-specific price extension
        PriceFeedStorage::set_arbitrum_price_ext(env, &update.extend);
        ArbitrumPriceExtUpdated { dst_eid: update.eid, arbitrum_price_ext: update.extend.clone() }.publish(env);
    }

    /// Set the native token price in USD (price updater or owner).
    ///
    /// Kept as a standalone contract function (not part of the canonical `fee_lib_interfaces::ILayerZeroPriceFeed` interface).
    pub fn set_native_token_price_usd(env: &Env, price_updater: &Address, native_token_price_usd: u128) {
        Self::require_owner_or_price_updater(env, price_updater);
        PriceFeedStorage::set_native_price_usd(env, &native_token_price_usd);
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    /// Check if an address is an active price updater
    pub fn is_price_updater(env: &Env, updater: &Address) -> bool {
        PriceFeedStorage::has_price_updater(env, updater)
    }

    /// Get the Arbitrum compression percent
    pub fn arbitrum_compression_percent(env: &Env) -> u128 {
        PriceFeedStorage::arbitrum_compression_percent(env)
    }

    /// Get the Arbitrum price extension
    pub fn arbitrum_price_ext(env: &Env) -> ArbitrumPriceExt {
        PriceFeedStorage::arbitrum_price_ext(env)
    }

    /// Get the model type for a destination EID
    pub fn eid_to_model_type(env: &Env, dst_eid: u32) -> ModelType {
        PriceFeedStorage::eid_to_model_type(env, dst_eid)
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Set price for a destination EID
    fn set_price_internal(env: &Env, dst_eid: u32, price: &Price) {
        PriceFeedStorage::set_default_model_price(env, dst_eid, price);
        PriceUpdated { dst_eid, price: price.clone() }.publish(env);
    }

    /// Estimate fee with default model
    fn estimate_fee_with_default_model(env: &Env, dst_eid: u32, calldata_size: u32, gas: u128) -> (u128, u128) {
        let price = Self::get_price(env, dst_eid).unwrap_or_panic(env, PriceFeedError::NoPrice);

        // assuming the _gas includes (1) the 21,000 overhead and (2) not the calldata gas
        let gas_for_calldata = (calldata_size as u128) * (price.gas_per_byte as u128);
        let remote_fee = (gas_for_calldata + gas) * (price.gas_price_in_unit as u128);
        let fee = (remote_fee * price.price_ratio) / Self::get_price_ratio_denominator(env);

        (fee, price.price_ratio)
    }

    /// Estimate fee with Optimism model
    fn estimate_fee_with_optimism_model(env: &Env, dst_eid: u32, calldata_size: u32, gas: u128) -> (u128, u128) {
        // L1 fee (Ethereum)
        let ethereum_id = Self::get_l1_lookup_id_for_optimism_model(env, dst_eid);
        let ethereum_price = Self::get_price(env, ethereum_id).unwrap_or_panic(env, PriceFeedError::NoPrice);
        let gas_for_l1_calldata = ((calldata_size as u128) * (ethereum_price.gas_per_byte as u128)) + 3188; // 2100 + 68 * 16
        let l1_fee = gas_for_l1_calldata * (ethereum_price.gas_price_in_unit as u128);

        // L2 fee (Optimism)
        let optimism_price = Self::get_price(env, dst_eid).unwrap_or_panic(env, PriceFeedError::NoPrice);
        let gas_for_l2_calldata = (calldata_size as u128) * (optimism_price.gas_per_byte as u128);
        let l2_fee = (gas_for_l2_calldata + gas) * (optimism_price.gas_price_in_unit as u128);

        let price_ratio_denom = Self::get_price_ratio_denominator(env);
        let l1_fee_in_src_price = (l1_fee * ethereum_price.price_ratio) / price_ratio_denom;
        let l2_fee_in_src_price = (l2_fee * optimism_price.price_ratio) / price_ratio_denom;
        let gas_fee = l1_fee_in_src_price + l2_fee_in_src_price;

        (gas_fee, optimism_price.price_ratio)
    }

    /// Estimate fee with Arbitrum model
    fn estimate_fee_with_arbitrum_model(env: &Env, dst_eid: u32, calldata_size: u32, gas: u128) -> (u128, u128) {
        // L1 fee (compressed calldata)
        let arbitrum_price_ext = Self::arbitrum_price_ext(env);
        let gas_for_l1_calldata = (((calldata_size as u128) * Self::arbitrum_compression_percent(env)) / 100)
            * (arbitrum_price_ext.gas_per_l1_calldata_byte as u128);

        // L2 fee
        let arbitrum_price = Self::get_price(env, dst_eid).unwrap_or_panic(env, PriceFeedError::NoPrice);
        let gas_for_l2_calldata = (calldata_size as u128) * (arbitrum_price.gas_per_byte as u128);
        let gas_fee = (gas + (arbitrum_price_ext.gas_per_l2_tx as u128) + gas_for_l1_calldata + gas_for_l2_calldata)
            * (arbitrum_price.gas_price_in_unit as u128);

        let fee = (gas_fee * arbitrum_price.price_ratio) / Self::get_price_ratio_denominator(env);

        (fee, arbitrum_price.price_ratio)
    }

    /// Get L1 lookup ID for Optimism model
    fn get_l1_lookup_id_for_optimism_model(env: &Env, l2_eid: u32) -> u32 {
        let eid = l2_eid % 30_000;

        if eid == 111 {
            return 101;
        } else if eid == 10132 {
            return 10121; // Ethereum Goerli
        } else if eid == 20132 {
            return 20121; // Ethereum Goerli
        }

        // Check if this EID is configured as OP_STACK model type
        assert_with_error!(env, Self::eid_to_model_type(env, eid) == ModelType::OpStack, PriceFeedError::NotAnOpStack);

        if eid < 10000 {
            101
        } else if eid < 20000 {
            10161 // Ethereum Sepolia
        } else {
            20121 // Ethereum Goerli
        }
    }

    /// Check if caller is price updater or owner
    fn require_owner_or_price_updater(env: &Env, caller: &Address) {
        caller.require_auth();
        assert_with_error!(
            env,
            Self::owner(env).as_ref() == Some(caller) || Self::is_price_updater(env, caller),
            PriceFeedError::OnlyPriceUpdater
        );
    }
}
