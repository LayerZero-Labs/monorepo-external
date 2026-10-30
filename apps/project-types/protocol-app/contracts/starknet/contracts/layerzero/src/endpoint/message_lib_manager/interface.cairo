use starknet::ContractAddress;
use crate::endpoint::message_lib_manager::structs::{GetLibraryResponse, Timeout};
use crate::message_lib::structs::SetConfigParam;

/// # `IMessageLibManager` Interface
///
/// The `IMessageLibManager` is responsible for managing the lifecycle and configuration of
/// message libraries within the LayerZero protocol. It handles both default (system-wide)
/// and custom (OApp-specific) library configurations for sending and receiving messages.
///
/// ## Key responsibilities
/// - Library registration and validation
/// - Default library management for the protocol
/// - Per-OApp library configuration
/// - Grace period management for library upgrades
/// - Configuration delegation to message libraries
#[starknet::interface]
pub trait IMessageLibManager<TContractState> {
    // ========================= Library Registration =========================

    /// Register a new message library with the endpoint (owner only)
    ///
    /// Only registered libraries can be used as send/receive libraries or set as defaults.
    /// The library must support the IMessageLib interface to be registered.
    ///
    /// # Arguments
    /// * `lib` - The contract address of the message library to register
    ///
    /// # Panics
    /// * If caller is not the owner
    /// * If library is already registered
    /// * If library doesn't implement the required interface
    fn register_library(ref self: TContractState, lib: ContractAddress);

    /// Get all registered message libraries
    ///
    /// Returns a list of all libraries that have been registered with the endpoint.
    /// This includes both active libraries and any that may be deprecated but still
    /// registered for backward compatibility.
    ///
    /// # Returns
    /// * `Array<ContractAddress>` - Array of all registered library addresses
    fn get_registered_libraries(self: @TContractState) -> Array<ContractAddress>;

    /// Check if a library is registered
    ///
    /// Returns true if the library has been registered with the endpoint.
    ///
    /// # Arguments
    /// * `lib` - The library address to check
    ///
    /// # Returns
    /// * `bool` - True if the library is registered, false otherwise
    fn is_registered_library(self: @TContractState, lib: ContractAddress) -> bool;

    // ========================= Send Library Management =========================

    /// Set the send library for the specified OApp and destination endpoint
    ///
    /// The send library is responsible for encoding and transmitting messages to the
    /// destination chain. If not set, the OApp will use the default send library.
    /// Only the OApp itself or its authorized delegates can set its send library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address setting its send library
    /// * `eid` - The destination endpoint ID
    /// * `lib` - The message library address (or DEFAULT_LIB to use default)
    ///
    /// # Panics
    /// * If caller is not the OApp or its authorized delegate
    /// * If library is not registered (unless DEFAULT_LIB)
    /// * If library doesn't support sending
    /// * If library doesn't support the specified endpoint
    /// * If the same library is already set (no-op protection)
    fn set_send_library(
        ref self: TContractState, oapp: ContractAddress, eid: u32, lib: ContractAddress,
    );

    /// Get the send library for a specific oapp and destination endpoint
    ///
    /// If the oapp hasn't set a custom send library, this resolves to the default
    /// send library configured by LayerZero. The library returned by this function
    /// will be used to process outbound messages.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address that wants to send messages
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// * `GetLibraryResponse` - Struct containing the resolved library address and whether it's the
    /// default
    ///
    /// # Panics
    /// * If no default send library is configured for the endpoint
    fn get_send_library(
        self: @TContractState, oapp: ContractAddress, dst_eid: u32,
    ) -> GetLibraryResponse;

    /// Get the raw send library for a specific oapp and destination endpoint
    ///
    /// Returns the raw send library for the given oapp and destination endpoint.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address that wants to send messages
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// * `ContractAddress` - The raw send library address
    fn get_raw_send_library(
        self: @TContractState, oapp: ContractAddress, dst_eid: u32,
    ) -> ContractAddress;

    /// Check if an OApp is using the default send library
    ///
    /// Returns true if the OApp hasn't set a custom send library for the given
    /// destination, meaning it will use the protocol's default send library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address to check
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// * `bool` - True if using default library, false if using custom library
    fn is_default_send_library(self: @TContractState, oapp: ContractAddress, dst_eid: u32) -> bool;

    /// Set the default send library for an endpoint (owner only)
    ///
    /// The default send library is used by OApps that haven't configured a custom
    /// send library. This is a protocol-level configuration that affects all OApps.
    ///
    /// # Arguments
    /// * `eid` - The destination endpoint ID
    /// * `lib` - The message library address to set as default
    ///
    /// # Panics
    /// * If caller is not the owner
    /// * If library is not registered
    /// * If library doesn't support sending
    /// * If library doesn't support the specified endpoint
    /// * If the same library is already set as default
    fn set_default_send_library(ref self: TContractState, eid: u32, lib: ContractAddress);


    /// Get the default send library for an endpoint
    ///
    /// Returns the default send library for the given endpoint.
    ///
    /// # Arguments
    /// * `eid` - The destination endpoint ID
    ///
    /// # Returns
    /// * `ContractAddress` - The default send library address
    fn get_default_send_library(self: @TContractState, eid: u32) -> ContractAddress;

    // ========================= Receive Library Management =========================

    /// Set the receive library for the specified OApp and source endpoint
    ///
    /// The receive library is responsible for verifying and processing incoming messages
    /// from the source chain. An optional grace period can be specified to allow the
    /// old library to remain valid during the transition.
    /// Only the OApp itself or its authorized delegates can set its receive library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address setting its receive library
    /// * `eid` - The source endpoint ID
    /// * `lib` - The message library address (or DEFAULT_LIB to use default)
    /// * `grace_period` - Number of blocks to keep the old library valid (0 for immediate switch)
    ///
    /// # Panics
    /// * If caller is not the OApp or its authorized delegate
    /// * If library is not registered (unless DEFAULT_LIB)
    /// * If library doesn't support receiving
    /// * If library doesn't support the specified endpoint
    /// * If the same library is already set (no-op protection)
    /// * If grace_period > 0 but either old or new library is DEFAULT_LIB
    fn set_receive_library(
        ref self: TContractState,
        oapp: ContractAddress,
        eid: u32,
        lib: ContractAddress,
        grace_period: u64,
    );

    /// Get the receive library for a specific oapp and source endpoint
    ///
    /// If the oapp hasn't set a custom receive library, this resolves to the default
    /// receive library configured by LayerZero.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address that will receive messages
    /// * `src_eid` - The source endpoint ID
    ///
    /// # Returns
    /// * `GetLibraryResponse` - Struct containing the resolved library address and whether it's the
    /// default
    ///
    /// # Panics
    /// * If no default receive library is configured for the endpoint
    fn get_receive_library(
        self: @TContractState, oapp: ContractAddress, src_eid: u32,
    ) -> GetLibraryResponse;

    /// Get the raw receive library for a specific oapp and source endpoint
    ///
    /// Returns the raw receive library for the given oapp and source endpoint.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address that will receive messages
    /// * `src_eid` - The source endpoint ID
    ///
    /// # Returns
    /// * `ContractAddress` - The raw receive library address
    fn get_raw_receive_library(
        self: @TContractState, oapp: ContractAddress, src_eid: u32,
    ) -> ContractAddress;

    /// Check if a receive library is valid for processing messages
    ///
    /// This validates whether the specified library can be used to verify messages
    /// for the given oapp and source endpoint. It considers both the currently
    /// configured library and any libraries in their grace period.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address that will receive messages
    /// * `src_eid` - The source endpoint ID
    /// * `lib` - The library address attempting to verify the message
    ///
    /// # Returns
    /// * `bool` - True if the library is valid for verification, false otherwise
    fn is_valid_receive_library(
        self: @TContractState, oapp: ContractAddress, src_eid: u32, lib: ContractAddress,
    ) -> bool;

    /// Set the default receive library for an endpoint (owner only)
    ///
    /// The default receive library is used by OApps that haven't configured a custom
    /// receive library. An optional grace period allows the old default library to
    /// remain valid during the transition.
    ///
    /// # Arguments
    /// * `eid` - The source endpoint ID
    /// * `lib` - The message library address to set as default
    /// * `grace_period` - Number of blocks to keep the old library valid (0 for immediate switch)
    ///
    /// # Panics
    /// * If caller is not the owner
    /// * If library is not registered
    /// * If library doesn't support receiving
    /// * If library doesn't support the specified endpoint
    /// * If the same library is already set as default
    fn set_default_receive_library(
        ref self: TContractState, eid: u32, lib: ContractAddress, grace_period: u64,
    );

    /// Get the default receive library for an endpoint
    ///
    /// Returns the default receive library for the given endpoint.
    ///
    /// # Arguments
    /// * `eid` - The source endpoint ID
    ///
    /// # Returns
    /// * `ContractAddress` - The default receive library address
    fn get_default_receive_library(self: @TContractState, eid: u32) -> ContractAddress;

    /// Check if an OApp is using the default receive library
    ///
    /// Returns true if the OApp hasn't set a custom receive library for the given
    /// source, meaning it will use the protocol's default receive library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address to check
    /// * `src_eid` - The source endpoint ID
    fn is_default_receive_library(
        self: @TContractState, oapp: ContractAddress, src_eid: u32,
    ) -> bool;

    /// Set a timeout for a receive library transition
    ///
    /// This allows fine-grained control over when libraries in grace period expire.
    /// Can be used to extend, shorten, or remove grace periods for library transitions.
    /// Only affects non-default library configurations.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address setting the timeout
    /// * `eid` - The source endpoint ID
    /// * `lib` - The library address to set timeout for
    /// * `expiry` - Block number when the library expires (0 to remove timeout)
    ///
    /// # Panics
    /// * If caller is not the OApp or its authorized delegate
    /// * If library is not registered
    /// * If library doesn't support receiving
    /// * If library doesn't support the specified endpoint
    /// * If OApp is using default library (can't set custom timeout)
    /// * If expiry is not in the future (when setting non-zero expiry)
    fn set_receive_library_timeout(
        ref self: TContractState,
        oapp: ContractAddress,
        eid: u32,
        lib: ContractAddress,
        expiry: u64,
    );

    /// Get the timeout for a receive library
    ///
    /// Returns the timeout for the specified receive library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address that will receive messages
    /// * `eid` - The source endpoint ID
    ///
    /// # Returns
    /// * `Timeout` - The timeout for the specified library
    fn get_receive_library_timeout(
        self: @TContractState, oapp: ContractAddress, eid: u32,
    ) -> Timeout;

    /// Set a timeout for the default receive library (owner only)
    ///
    /// This controls the grace period for the protocol's default receive library.
    /// Unlike the OApp-specific timeout, this affects all OApps using the default library.
    ///
    /// # Arguments
    /// * `eid` - The source endpoint ID
    /// * `lib` - The library address to set timeout for
    /// * `expiry` - Block number when the library expires (0 to remove timeout)
    ///
    /// # Panics
    /// * If caller is not the owner
    /// * If library is not registered
    /// * If library doesn't support receiving
    /// * If library doesn't support the specified endpoint
    /// * If expiry is not in the future (when setting non-zero expiry)
    fn set_default_receive_library_timeout(
        ref self: TContractState, eid: u32, lib: ContractAddress, expiry: u64,
    );

    /// Get the timeout for the default receive library
    ///
    /// Returns the timeout for the default receive library.
    ///
    /// # Arguments
    /// * `eid` - The source endpoint ID
    ///
    /// # Returns
    /// * `Timeout` - The timeout for the default library
    fn get_default_receive_library_timeout(self: @TContractState, eid: u32) -> Timeout;

    // ========================= Configuration Management =========================

    /// Set send configuration for an OApp
    ///
    /// This function allows an OApp to set configuration parameters for its send library.
    /// The configuration is specific to the message library. Endpoint-specific settings
    /// are provided within the SetConfigParam array.
    /// Only the OApp itself or its authorized delegates can set its configuration.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address setting configuration
    /// * `lib` - The message library to set configuration for
    /// * `params` - Array of configuration parameters to set
    ///
    /// # Panics
    /// * If caller is not the OApp or its authorized delegate
    /// * If library is not registered
    /// * If library doesn't support sending
    fn set_send_configs(
        ref self: TContractState,
        oapp: ContractAddress,
        lib: ContractAddress,
        params: Array<SetConfigParam>,
    );

    /// Get send configuration from a message library
    ///
    /// This is a pass-through function that delegates configuration queries to the
    /// specified message library. The configuration is OApp-specific and depends on
    /// the library's implementation.
    ///
    /// Note: This queries the configuration from the message library. Configuration can be set
    /// either through this endpoint's set_send_configs function or directly via the library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address requesting configuration
    /// * `lib` - The message library to query
    /// * `eid` - The endpoint ID for the configuration
    /// * `config_type` - The type of configuration being requested
    ///
    /// # Returns
    /// * `Array<felt252>` - The encoded configuration data
    ///
    /// # Panics
    /// * If library is not registered
    /// * If library doesn't support sending
    fn get_send_config(
        self: @TContractState,
        oapp: ContractAddress,
        lib: ContractAddress,
        eid: u32,
        config_type: u32,
    ) -> Array<felt252>;

    /// Set receive configuration for an OApp
    ///
    /// This function allows an OApp to set configuration parameters for its receive library.
    /// The configuration is specific to the message library. Endpoint-specific settings
    /// are provided within the SetConfigParam array.
    /// Only the OApp itself or its authorized delegates can set its configuration.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address setting configuration
    /// * `lib` - The message library to set configuration for
    /// * `params` - Array of configuration parameters to set
    ///
    /// # Panics
    /// * If caller is not the OApp or its authorized delegate
    /// * If library is not registered
    /// * If library doesn't support receiving
    fn set_receive_configs(
        ref self: TContractState,
        oapp: ContractAddress,
        lib: ContractAddress,
        params: Array<SetConfigParam>,
    );

    /// Get receive configuration from a message library
    ///
    /// This is a pass-through function that delegates configuration queries to the
    /// specified message library. The configuration is OApp-specific and depends on
    /// the library's implementation.
    ///
    /// Note: This queries the configuration from the message library. Configuration can be set
    /// either through this endpoint's set_receive_configs function or directly via the library.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address requesting configuration
    /// * `lib` - The message library to query
    /// * `eid` - The endpoint ID for the configuration
    /// * `config_type` - The type of configuration being requested
    ///
    /// # Returns
    /// * `Array<felt252>` - The encoded configuration data
    ///
    /// # Panics
    /// * If library is not registered
    /// * If library doesn't support receiving
    fn get_receive_config(
        self: @TContractState,
        oapp: ContractAddress,
        lib: ContractAddress,
        eid: u32,
        config_type: u32,
    ) -> Array<felt252>;

    // ========================= Utility Functions =========================

    /// Check if an endpoint is supported by the protocol
    ///
    /// An endpoint is considered supported if it has both default send and receive
    /// libraries configured. This indicates that the endpoint is ready for general use.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID to check
    ///
    /// # Returns
    /// * `bool` - True if the endpoint has both default libraries configured
    fn is_supported_eid(self: @TContractState, eid: u32) -> bool;
}
