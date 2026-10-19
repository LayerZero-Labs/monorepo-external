//! DVN structs

use starknet::account::Call;
use starknet::secp256_trait::Signature;

/// DVN option
pub struct DvnOption {
    /// Size of the option
    pub option_size: u16,
    /// Index of the DVN
    pub dvn_index: u8,
    /// Type of the option
    pub option_type: u8,
    /// Data of the option
    pub option_data: ByteArray,
    /// Cursor position
    pub cursor: u32,
}

/// Destination config
#[derive(Copy, Default, Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct DstConfig {
    /// Gas for the destination
    pub gas: u64,
    /// Multiplier basis points
    pub multiplier_bps: u16,
    /// Floor margin in USD - uses priceFeed PRICE_RATIO_DENOMINATOR
    pub floor_margin_usd: u128,
}

/// Parameters for setting the destination config
#[derive(Copy, Default, Drop, Serde, PartialEq, Debug)]
pub struct SetDstConfigParams {
    /// Destination endpoint ID
    pub dst_eid: u32,
    /// Destination config
    pub config: DstConfig,
}

/// Parameters for executing a job
#[derive(Drop, Serde, Clone)]
pub struct ExecuteParam {
    /// Verifier ID
    pub vid: u32,
    /// Call data
    pub call_data: Call,
    /// Expiration of the instruction
    pub expiration: u256,
    /// Signatures for the instruction
    pub signatures: Span<Signature>,
}
