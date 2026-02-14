//! Fuzzable prices

use layerzero::workers::price_feed::structs::{ArbitrumPriceExt, Price};
use snforge_std::fuzzable::Fuzzable;

/// Generate a random price
pub(crate) impl FuzzablePrice of Fuzzable<Price> {
    fn generate() -> Price {
        Price {
            gas_price_in_unit: Fuzzable::generate(),
            gas_per_byte: Fuzzable::generate(),
            price_ratio: Fuzzable::generate(),
        }
    }

    fn blank() -> Price {
        Default::default()
    }
}

/// Generate a random arbitrum price ext
pub(crate) impl FuzzableArbitrumPriceExt of Fuzzable<ArbitrumPriceExt> {
    fn generate() -> ArbitrumPriceExt {
        ArbitrumPriceExt {
            gas_per_l2_tx: Fuzzable::generate(), gas_per_l1_call_data_byte: Fuzzable::generate(),
        }
    }

    fn blank() -> ArbitrumPriceExt {
        Default::default()
    }
}
