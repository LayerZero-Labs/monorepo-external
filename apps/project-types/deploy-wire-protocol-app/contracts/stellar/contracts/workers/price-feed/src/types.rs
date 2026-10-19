use fee_lib_interfaces::Price;
use soroban_sdk::contracttype;

/// Arbitrum-specific price extension
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbitrumPriceExt {
    /// Gas overhead per L2 transaction
    pub gas_per_l2_tx: u64,

    /// Gas cost per byte of L1 calldata (for Arbitrum's L1 data posting)
    pub gas_per_l1_calldata_byte: u32,
}

/// Parameter for updating a single price
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdatePrice {
    /// Destination endpoint ID
    pub eid: u32,

    /// Price information for the destination
    pub price: Price,
}

/// Parameter for updating Arbitrum price with extension
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdatePriceExt {
    /// Destination endpoint ID (should be an Arbitrum endpoint)
    pub eid: u32,

    /// Price information for the destination
    pub price: Price,

    /// Arbitrum-specific pricing extension
    pub extend: ArbitrumPriceExt,
}

/// Fee model type for different chain architectures
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ModelType {
    Default = 0,
    ArbStack = 1,
    OpStack = 2,
}

/// Parameter for setting EID to model type mapping
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SetEidToModelTypeParam {
    /// Destination endpoint ID
    pub dst_eid: u32,

    /// Fee model type for this destination
    pub model_type: ModelType,
}
