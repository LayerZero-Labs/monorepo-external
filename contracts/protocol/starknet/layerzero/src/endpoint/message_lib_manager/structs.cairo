//! Message library manager structs

use starknet::ContractAddress;
use crate::endpoint::message_lib_manager::message_lib_manager::MessageLibManagerComponent::DEFAULT_LIB;

/// Timeout struct for receive library grace periods
///
/// When upgrading receive libraries, the old library can be given a grace period
/// during which it remains valid for receiving messages. This allows for smooth
/// transitions without breaking in-flight messages.
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq)]
pub struct Timeout {
    /// The library contract address that is in grace period
    pub lib: ContractAddress,
    /// Block number when the grace period expires
    pub expiry: u64,
}

impl DefaultTimeout of Default<Timeout> {
    fn default() -> Timeout {
        Timeout { lib: DEFAULT_LIB, expiry: 0 }
    }
}

/// Response struct for get_receive_library function
///
/// Contains the library address and a boolean indicating if it's the default library
/// Used to return the resolved library and its type (custom or default)
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq)]
pub struct GetLibraryResponse {
    pub lib: ContractAddress,
    pub is_default: bool,
}
