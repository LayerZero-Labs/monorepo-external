use soroban_sdk::{contractevent, Address};

use fee_lib_interfaces::Price;

use crate::types::ArbitrumPriceExt;

// ============================================================================
// Price Feed Events
// ============================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceUpdaterSet {
    pub updater: Address,
    pub active: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceUpdated {
    pub dst_eid: u32,
    pub price: Price,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArbitrumPriceExtUpdated {
    pub dst_eid: u32,
    pub arbitrum_price_ext: ArbitrumPriceExt,
}
