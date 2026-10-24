use soroban_sdk::{contractclient, contracttype, Address, Bytes, Env, Vec};

/// Timeout configuration for receive library transitions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Timeout {
    /// The old library address that remains valid during the grace period.
    pub lib: Address,
    /// Unix timestamp in seconds when the timeout expires.
    pub expiry: u64,
}

impl Timeout {
    /// Checks if the timeout has expired.
    pub fn is_expired(&self, env: &Env) -> bool {
        self.expiry <= env.ledger().timestamp()
    }

    /// Checks if the timeout is valid for the given library (matches and not expired).
    pub fn is_valid_for(&self, env: &Env, lib: &Address) -> bool {
        &self.lib == lib && !self.is_expired(env)
    }
}

/// Parameters for setting message library configuration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetConfigParam {
    /// The endpoint ID this config applies to.
    pub eid: u32,
    /// The type of configuration (e.g., executor, ULN).
    pub config_type: u32,
    /// XDR-encoded configuration data.
    pub config: Bytes,
}

/// Resolved library information with default status.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedLibrary {
    /// The resolved library address.
    pub lib: Address,
    /// Whether this is the default library (true) or OApp-specific (false).
    pub is_default: bool,
}

/// EndpointV2's Interface for managing message libraries.
#[contractclient(name = "MessageLibManagerClient")]
pub trait IMessageLibManager {
    /// Registers a new message library with the endpoint.
    ///
    /// # Arguments
    /// * `new_lib` - The address of the message library to register
    fn register_library(env: &Env, new_lib: &Address);

    /// Checks if a message library is registered.
    ///
    /// # Arguments
    /// * `lib` - The address of the message library to check
    fn is_registered_library(env: &Env, lib: &Address) -> bool;

    /// Returns the index of a message library.
    ///
    /// # Arguments
    /// * `lib` - The address of the message library to check
    ///
    /// # Returns
    /// * `Option<u32>` - The index of the message library, or `None` if the library is not registered
    fn get_library_index(env: &Env, lib: &Address) -> Option<u32>;

    /// Returns a list of registered message libraries within the specified range.
    ///
    /// # Arguments
    /// * `start` - The starting index
    /// * `max_count` - The maximum number of libraries to return
    fn get_registered_libraries(env: &Env, start: u32, max_count: u32) -> Vec<Address>;

    /// Returns the number of registered message libraries.
    fn registered_libraries_count(env: &Env) -> u32;

    /// Sets the default send library for a destination endpoint.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    /// * `new_lib` - The library address to set as default
    fn set_default_send_library(env: &Env, dst_eid: u32, new_lib: &Address);

    /// Returns the default send library for a destination endpoint.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    fn default_send_library(env: &Env, dst_eid: u32) -> Option<Address>;

    /// Sets the default receive library for a source endpoint.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID
    /// * `new_lib` - The library address to set as default
    /// * `grace_period` - Time in seconds during which the old library remains valid
    fn set_default_receive_library(env: &Env, src_eid: u32, new_lib: &Address, grace_period: u64);

    /// Returns the default receive library for a source endpoint.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID
    fn default_receive_library(env: &Env, src_eid: u32) -> Option<Address>;

    /// Sets or removes the default receive library timeout for a source endpoint.
    ///
    /// This function provides the same functionality as `setDefaultReceiveLibraryTimeout` on EVM.
    /// The function name has been shortened to `set_default_receive_lib_timeout` due to Stellar's
    /// naming constraints.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID
    /// * `timeout` - The timeout configuration, or `None` to remove it
    fn set_default_receive_lib_timeout(env: &Env, src_eid: u32, timeout: &Option<Timeout>);

    /// Returns the default receive library timeout for a source endpoint.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID
    fn default_receive_library_timeout(env: &Env, src_eid: u32) -> Option<Timeout>;

    /// Checks if an endpoint ID is supported (both send and receive libraries are set).
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    fn is_supported_eid(env: &Env, eid: u32) -> bool;

    /// Checks if a receive library is valid for an OApp and source endpoint.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `lib` - The library address to check
    fn is_valid_receive_library(env: &Env, receiver: &Address, src_eid: u32, lib: &Address) -> bool;

    // ============================================================================================
    // OApp Control Functions
    // ============================================================================================

    /// Sets or removes a custom send library for an OApp.
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `new_lib` - The library address, or `None` to use the default
    fn set_send_library(env: &Env, caller: &Address, sender: &Address, dst_eid: u32, new_lib: &Option<Address>);

    /// Returns the effective send library for an OApp and destination endpoint.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    fn get_send_library(env: &Env, sender: &Address, dst_eid: u32) -> ResolvedLibrary;

    /// Sets or removes a custom receive library for an OApp.
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `new_lib` - The library address, or `None` to use the default
    /// * `grace_period` - Time in seconds during which the old library remains valid
    fn set_receive_library(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        new_lib: &Option<Address>,
        grace_period: u64,
    );

    /// Returns the effective receive library for an OApp and source endpoint.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    fn get_receive_library(env: &Env, receiver: &Address, src_eid: u32) -> ResolvedLibrary;

    /// Sets or removes the receive library timeout for an OApp.
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `timeout` - The timeout configuration, or `None` to remove
    fn set_receive_library_timeout(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        timeout: &Option<Timeout>,
    );

    /// Returns the receive library timeout for an OApp and source endpoint.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    fn receive_library_timeout(env: &Env, receiver: &Address, src_eid: u32) -> Option<Timeout>;

    /// Sets the configuration for a message library.
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `oapp` - The OApp address
    /// * `lib` - The message library address
    /// * `params` - The configuration parameters
    fn set_config(env: &Env, caller: &Address, oapp: &Address, lib: &Address, params: &Vec<SetConfigParam>);

    /// Returns the configuration for a message library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address
    /// * `lib` - The message library address
    /// * `eid` - The endpoint ID
    /// * `config_type` - The type of configuration
    fn get_config(env: &Env, oapp: &Address, lib: &Address, eid: u32, config_type: u32) -> Bytes;
}
