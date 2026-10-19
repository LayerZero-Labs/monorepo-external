use crate::SetConfigParam;
use soroban_sdk::{contractclient, contracttype, Address, Bytes, Env, Vec};

/// Type of message library indicating supported operations.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum MessageLibType {
    /// Supports only sending messages.
    Send,
    /// Supports only receiving messages.
    Receive,
    /// Supports both sending and receiving messages.
    SendAndReceive,
}

/// Version information for a message library.
///
/// Note: `minor` and `endpoint_version` use `u32` instead of `u8` because Stellar does not
/// support `u8` types in contract interface functions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessageLibVersion {
    /// Major version number.
    pub major: u64,
    /// Minor version number (should not exceed u8::MAX = 255).
    pub minor: u32,
    /// Endpoint version (should not exceed u8::MAX = 255).
    pub endpoint_version: u32,
}

/// Interface for message libraries that handle cross-chain message verification and delivery.
#[contractclient(name = "MessageLibClient")]
pub trait IMessageLib {
    /// Sets the configuration for an OApp by the Endpoint.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address
    /// * `params` - Library-specific configuration parameters (e.g., DVN configs, executor configs)
    fn set_config(env: &Env, oapp: &Address, params: &Vec<SetConfigParam>);

    /// Returns the configuration for a specific endpoint ID and config type.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    /// * `oapp` - The OApp address
    /// * `config_type` - The type of configuration
    fn get_config(env: &Env, eid: u32, oapp: &Address, config_type: u32) -> Bytes;

    /// Checks if an endpoint ID is supported by this library.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    fn is_supported_eid(env: &Env, eid: u32) -> bool;

    /// Returns the version information of this library.
    fn version(env: &Env) -> MessageLibVersion;

    /// Returns the type of this message library.
    fn message_lib_type(env: &Env) -> MessageLibType;
}
