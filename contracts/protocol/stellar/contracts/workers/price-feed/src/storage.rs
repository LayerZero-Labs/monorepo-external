use common_macros::storage;
use fee_lib_interfaces::Price;
use soroban_sdk::Address;

use crate::types::{ArbitrumPriceExt, ModelType};

#[storage()]
pub enum PriceFeedStorage {
    /// Price ratio denominator used for price calculations (initialized to 1e20)
    #[instance(u128)]
    #[default(10u128.pow(20))]
    PriceRatioDenominator,

    /// Price updater status mapping (address => bool active)
    #[persistent(bool)]
    #[default(false)]
    PriceUpdater { updater: Address },

    /// Default price model for each destination EID
    #[persistent(Price)]
    DefaultModelPrice { dst_eid: u32 },

    /// Arbitrum-specific price extension
    #[instance(ArbitrumPriceExt)]
    #[default(ArbitrumPriceExt { gas_per_l2_tx: 0, gas_per_l1_calldata_byte: 0 })]
    ArbitrumPriceExt,

    /// Native token price in USD (uses PRICE_RATIO_DENOMINATOR)
    #[instance(u128)]
    #[default(0)]
    NativePriceUSD,

    /// Arbitrum compression percentage (initialized to 47)
    #[instance(u128)]
    #[default(47)]
    ArbitrumCompressionPercent,

    /// Fee model type for each destination EID
    #[persistent(ModelType)]
    #[default(ModelType::Default)]
    EidToModelType { dst_eid: u32 },
}
