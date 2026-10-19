//! Price feed structs

/// Fee estimate
#[derive(Drop, Serde, Default, PartialEq, Debug)]
pub struct FeeEstimate {
    pub gas_fee: u256,
    pub price_ratio: u128,
}

/// Response for a fee estimation
#[derive(Drop, Serde, Default, PartialEq, Debug)]
pub struct GetFeeResponse {
    pub gas_fee: u256,
    pub price_ratio: u128,
    pub price_ratio_denominator: u128,
    pub native_price_usd: u128,
}

/// Price for a given EID
#[derive(Drop, Serde, starknet::Store, Default, PartialEq, Clone, Debug)]
pub struct Price {
    /// Conversion multiplier used to translate the destination chain's native token value
    /// into the source chain's native token units.
    ///
    /// This is a fixed-point number encoded as a `u128`, where the float value is scaled
    /// by 10^20 for precision (i.e., 1.0 = 10^20).
    ///
    /// The `price_ratio` incorporates two factors:
    ///   1. Decimal normalization between destination and source tokens.
    ///   2. The actual relative price (exchange rate) between the two tokens.
    ///
    /// For example, if the source is an EVM chain (18 decimals) and the destination is Aptos (8
    /// decimals), with a 1:1 token price, the base multiplier would be (10^18 / 10^8) = 10^10.
    /// To represent this in fixed-point form, you multiply by 10^20, giving a `price_ratio` of
    /// 10^30.
    ///
    /// In real usage, `price_ratio` reflects both decimal scaling and fluctuating market prices.
    pub price_ratio: u128,
    pub gas_price_in_unit: u64, // for evm, it is in wei, for aptos, it is in octas.
    pub gas_per_byte: u32,
}

#[derive(Drop, Serde, Default, PartialEq)]
pub struct SetEidToModelTypeParam {
    pub eid: u32,
    pub model_type: ModelType,
}

#[derive(Drop, Serde, Default, PartialEq)]
pub struct SetPriceParam {
    pub eid: u32,
    pub price: Price,
}

#[derive(Drop, Serde, starknet::Store, Default, PartialEq, Clone, Debug)]
pub struct ArbitrumPriceExt {
    pub gas_per_l2_tx: u64,
    pub gas_per_l1_call_data_byte: u32,
}

#[derive(Drop, Serde, Default, PartialEq, Clone)]
pub struct UpdatePriceExt {
    pub eid: u32,
    pub price: Price,
    pub extend: ArbitrumPriceExt,
}

#[derive(Drop, Serde, starknet::Store, Default, PartialEq, Debug)]
pub enum ModelType {
    #[default]
    DEFAULT,
    OP_STACK,
    ARB_STACK,
}
