//! Executor structs

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::Origin;

#[derive(Copy, Drop, Serde, starknet::Store, PartialEq, Default, Debug)]
pub struct DstConfig {
    /// The base gas for `lz_receive`
    pub lz_receive_base_gas: u64,
    /// The gas multiplier in basis points
    pub multiplier_bps: u16,
    /// The floor margin in USD (uses priceFeed PRICE_RATIO_DENOMINATOR)
    pub floor_margin_usd: u128,
    /// The native token cap
    pub native_cap: u128,
    /// The base gas for `lz_compose`
    pub lz_compose_base_gas: u64,
}

#[derive(Copy, Drop, Serde, PartialEq)]
pub struct SetDstConfigParams {
    /// The destination endpoint ID
    pub dst_eid: u32,
    /// The destination configuration
    pub config: DstConfig,
}

#[derive(Drop, Serde, Clone)]
pub struct ExecuteParams {
    /// The address of the receiver contract
    pub receiver: ContractAddress,
    /// The origin information of the message
    pub origin: Origin,
    /// The globally unique identifier for the message
    pub guid: Bytes32,
    /// The amount of native tokens to be sent with the message
    pub value: u256,
    /// The message payload
    pub message: ByteArray,
    /// The gas limit for the execution
    pub gas_limit: u256,
    /// Extra data for the execution
    pub extra_data: ByteArray,
}

#[derive(Drop, Serde, Clone)]
pub struct ComposeParams {
    /// The address of the receiver contract
    pub receiver: ContractAddress,
    /// The address of the sender contract
    pub sender: ContractAddress,
    /// The globally unique identifier for the message
    pub guid: Bytes32,
    /// The index for composing messages
    pub index: u16,
    /// The amount of native tokens to be sent with the message
    pub value: u256,
    /// The message payload
    pub message: ByteArray,
    /// Extra data for composing the message
    pub extra_data: ByteArray,
    /// The gas limit for the composition
    pub gas_limit: u256,
}

#[derive(Drop, Serde)]
pub enum ExecutorOption {
    LzReceive: LzReceiveOption,
    NativeDrop: NativeDropOption,
    LzCompose: LzComposeOption,
    OrderedExecution,
    LzRead: LzReadOption,
}

#[derive(Debug, Drop, Serde, Clone)]
pub struct LzReceiveOption {
    /// The gas limit for `lz_receive`
    pub gas: u128,
    /// The native token value to be sent with `lz_receive`
    pub value: u128,
}

#[derive(Drop, Serde, Clone)]
pub struct NativeDropOption {
    /// The amount of native tokens to drop
    pub amount: u128,
    /// The recipient address for the native drop
    pub receiver: Bytes32,
}

/// Native drop parameters.
#[derive(Drop, Serde, Clone)]
pub struct NativeDropParams {
    /// Amount of the native tokens
    pub amount: u256,
    /// Receiver of the native tokens
    pub receiver: ContractAddress,
}

#[derive(Debug, Drop, Serde, Clone)]
pub struct LzComposeOption {
    /// The index for composing messages
    pub index: u16,
    /// The gas limit for `lz_compose`
    pub gas: u128,
    /// The native token value to be sent with `lz_compose`
    pub value: u128,
}

#[derive(Drop, Serde, Clone)]
pub struct LzReadOption {
    /// The gas limit for the read operation
    pub gas: u128,
    /// The size of the data to be read
    pub size: u32,
    /// The native token value to be sent with the read operation
    pub value: u128,
}
