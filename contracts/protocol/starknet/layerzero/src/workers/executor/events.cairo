//! Executor events

use starknet::ContractAddress;
use crate::Origin;
use crate::workers::executor::structs::{NativeDropParams, SetDstConfigParams};

/// Emitted when a destination configuration is set or updated.
/// @dev Triggered by the `set_dst_config` function.
#[derive(Drop, starknet::Event)]
pub struct DstConfigSet {
    /// The destination configurations that were set.
    pub dst_config_set: Span<SetDstConfigParams>,
}

/// Emitted when a native token drop is applied.
/// @dev Triggered by the `_apply_native_drop` internal function.
#[derive(Drop, starknet::Event)]
pub struct NativeDropApplied {
    /// The origin information of the message.
    #[key]
    pub origin: Origin,
    /// The destination endpoint ID.
    #[key]
    pub dst_eid: u32,
    /// The OApp that received the native drop.
    #[key]
    pub oapp: ContractAddress,
    /// The parameters for the native drop.
    pub native_drop_params: Array<NativeDropParams>,
    /// An array indicating the success of each native drop.
    pub success: Array<bool>,
}
