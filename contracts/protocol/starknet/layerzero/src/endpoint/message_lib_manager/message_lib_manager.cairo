//! Message library manager component

/// # `MessageLibManagerComponent`
///
/// The MessageLibManager is the core component responsible for managing the lifecycle of message
/// libraries within the LayerZero protocol. It provides a unified interface for:
///
/// - **Library Registration**: Validating and registering message libraries that implement the
/// IMessageLib interface - **Default Library Management**: Managing protocol-wide default libraries
/// for each endpoint - **Per-OApp Configuration**: Allowing individual OApps to configure custom
/// send/receive libraries - **Grace Period Handling**: Managing smooth transitions between library
/// versions with configurable timeouts
/// requests to the appropriate message libraries
///
/// ## Library Resolution Logic
///
/// ### Send Libraries
/// When an OApp sends a message, the library resolution follows this priority:
/// 1. OApp's custom send library (if configured)
/// 2. Protocol's default send library for the destination endpoint
///
/// ### Receive Libraries
/// When validating incoming messages, libraries are considered valid if they are:
/// 1. The currently configured receive library for the OApp/endpoint
/// 2. A library in its grace period (during library transitions)
///
/// ## Grace Period Mechanism
///
/// To ensure smooth upgrades without breaking in-flight messages, the MessageLibManager supports
/// grace periods during library transitions. When a new receive library is set, the old library
/// can remain valid for a specified number of blocks, allowing time for pending messages to be
/// processed.
#[starknet::component]
pub mod MessageLibManagerComponent {
    use core::num::traits::Zero;
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::access::ownable::OwnableComponent::{
        InternalImpl as OwnableInternalImpl, InternalTrait as OwnableInternalTrait,
    };
    use starknet::storage::{
        Map, MutableVecTrait, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
        Vec, VecTrait,
    };
    use starknet::{ContractAddress, get_block_number};
    use crate::common::constants::ZERO_ADDRESS;
    use crate::endpoint::message_lib_manager::errors::{
        err_already_registered, err_default_receive_lib_unavailable,
        err_default_send_lib_unavailable, err_invalid_expiry, err_only_non_default_lib,
        err_only_receive_lib, err_only_registered_lib, err_only_registered_or_default_lib,
        err_only_send_lib, err_same_value, err_unsupported_eid,
    };
    use crate::endpoint::message_lib_manager::events::{
        DefaultReceiveLibrarySet, DefaultReceiveLibraryTimeoutSet, DefaultSendLibrarySet,
        LibraryRegistered, ReceiveLibrarySet, ReceiveLibraryTimeoutSet, SendLibrarySet,
    };
    use crate::endpoint::message_lib_manager::interface::IMessageLibManager;
    use crate::endpoint::message_lib_manager::structs::{GetLibraryResponse, Timeout};
    use crate::message_lib::interface::{IMessageLibDispatcher, IMessageLibDispatcherTrait};
    use crate::message_lib::structs::{MessageLibType, SetConfigParam};

    /// Constant representing the default library (address 0)
    /// Used to indicate when an OApp wants to use the protocol's default library
    pub const DEFAULT_LIB: ContractAddress = ZERO_ADDRESS;

    const DEFAULT_EXPIRY: u64 = 0;

    const DEFAULT_TIMEOUT: Timeout = Timeout { lib: DEFAULT_LIB, expiry: DEFAULT_EXPIRY };

    /// =============================== Storage =================================
    #[storage]
    pub struct Storage {
        /// Immutable library that reverts both on send and quote operations
        /// This is set during initialization and provides a way to "block" an endpoint
        pub blocked_library: ContractAddress,
        /// Mapping to track which libraries have been registered with the endpoint
        /// Only registered libraries can be used as send/receive libraries or defaults
        /// lib_address => is_registered
        pub is_registered_library: Map<ContractAddress, bool>,
        /// Dynamic array storing all registered library addresses
        /// Used for querying the complete list of registered libraries
        pub registered_libraries: Vec<ContractAddress>,
        /// OApp-specific send library configurations
        /// Maps from sender address to destination endpoint to library address
        /// If not set or set to DEFAULT_LIB, resolves to the default send library
        /// sender_address => dst_eid => library_address
        pub send_library: Map<ContractAddress, Map<u32, ContractAddress>>,
        /// OApp-specific receive library configurations
        /// Maps from receiver address to source endpoint to library address
        /// If not set or set to DEFAULT_LIB, resolves to the default receive library
        /// receiver_address => src_eid => library_address
        pub receive_library: Map<ContractAddress, Map<u32, ContractAddress>>,
        /// Timeout configurations for OApp-specific receive library transitions
        /// Stores grace period information when OApps upgrade their receive libraries
        /// receiver_address => src_eid => timeout_info
        pub receive_library_timeout: Map<ContractAddress, Map<u32, Timeout>>,
        /// Protocol-wide default send libraries for each endpoint
        /// Used when OApps haven't configured a custom send library
        /// dst_eid => library_address
        pub default_send_library: Map<u32, ContractAddress>,
        /// Protocol-wide default receive libraries for each endpoint
        /// Used when OApps haven't configured a custom receive library
        /// src_eid => library_address
        pub default_receive_library: Map<u32, ContractAddress>,
        /// Timeout configurations for default receive library transitions
        /// Manages grace periods when the protocol upgrades default receive libraries
        /// src_eid => timeout_info
        pub default_receive_library_timeout: Map<u32, Timeout>,
    }

    /// =============================== Events =================================
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LibraryRegistered: LibraryRegistered,
        SendLibrarySet: SendLibrarySet,
        ReceiveLibrarySet: ReceiveLibrarySet,
        DefaultSendLibrarySet: DefaultSendLibrarySet,
        DefaultReceiveLibrarySet: DefaultReceiveLibrarySet,
        ReceiveLibraryTimeoutSet: ReceiveLibraryTimeoutSet,
        DefaultReceiveLibraryTimeoutSet: DefaultReceiveLibraryTimeoutSet,
    }

    // =============================== Hooks =================================
    pub trait MessageLibManagerHooks<TContractState> {
        fn _assert_authorized(self: @ComponentState<TContractState>, oapp: ContractAddress);
    }

    /// =============================== Implementation =================================
    #[embeddable_as(MessageLibManagerImpl)]
    impl MessageLibManager<
        TContractState,
        +HasComponent<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
        +MessageLibManagerHooks<TContractState>,
        +Drop<TContractState>,
    > of IMessageLibManager<ComponentState<TContractState>> {
        // ========================= Library Registration =========================

        fn register_library(ref self: ComponentState<TContractState>, lib: ContractAddress) {
            // Only the owner can register new libraries
            self._assert_only_owner();

            let is_registered_entry = self.is_registered_library.entry(lib);

            // Must not have been registered before to prevent duplicates
            assert_with_byte_array(!is_registered_entry.read(), err_already_registered());

            // Query the library for its type to ensure it implements IMessageLib.
            // This adds a safety check at registration time similar to EVM parity.
            let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
            let _ = lib_dispatcher.message_lib_type();

            // Add to registered libraries mapping and array
            is_registered_entry.write(true);
            self.registered_libraries.push(lib);

            self.emit(LibraryRegistered { library: lib });
        }

        fn is_registered_library(
            self: @ComponentState<TContractState>, lib: ContractAddress,
        ) -> bool {
            self.is_registered_library.entry(lib).read()
        }

        fn get_registered_libraries(
            self: @ComponentState<TContractState>,
        ) -> Array<ContractAddress> {
            let mut libraries = array![];

            // Iterate through all registered libraries and collect them
            for i in 0..self.registered_libraries.len() {
                libraries.append(self.registered_libraries.get(i).unwrap().read());
            }

            libraries
        }

        // ========================= Send Library Management =========================

        fn set_send_library(
            ref self: ComponentState<TContractState>,
            oapp: ContractAddress,
            eid: u32,
            lib: ContractAddress,
        ) {
            // Only the OApp itself can set its send library
            self._assert_authorized(oapp);

            let send_library_entry = self.send_library.entry(oapp).entry(eid);
            // Prevent no-op updates (must provide a different value)
            let old_lib = send_library_entry.read();
            assert_with_byte_array(old_lib != lib, err_same_value());

            // Validate library registration, type, and endpoint support
            self._assert_registered_or_default(lib);
            self._assert_send_lib(lib);
            self._assert_supported_send_eid(lib, eid);

            // Update the send library configuration
            send_library_entry.write(lib);
            self.emit(SendLibrarySet { sender: oapp, dst_eid: eid, library: lib });
        }

        fn get_send_library(
            self: @ComponentState<TContractState>, oapp: ContractAddress, dst_eid: u32,
        ) -> GetLibraryResponse {
            // Get the OApp's custom send library configuration
            let lib = self.send_library.entry(oapp).entry(dst_eid).read();

            // If not set or set to DEFAULT_LIB, resolve to the protocol default
            if lib == DEFAULT_LIB {
                let default_lib = self.default_send_library.entry(dst_eid).read();
                assert_with_byte_array(
                    default_lib.is_non_zero(), err_default_send_lib_unavailable(),
                );
                GetLibraryResponse { lib: default_lib, is_default: true }
            } else {
                GetLibraryResponse { lib, is_default: false }
            }
        }

        fn get_raw_send_library(
            self: @ComponentState<TContractState>, oapp: ContractAddress, dst_eid: u32,
        ) -> ContractAddress {
            self.send_library.entry(oapp).entry(dst_eid).read()
        }

        fn is_default_send_library(
            self: @ComponentState<TContractState>, oapp: ContractAddress, dst_eid: u32,
        ) -> bool {
            // Check if the OApp is using the protocol's default send library
            self.send_library.entry(oapp).entry(dst_eid).read() == DEFAULT_LIB
        }

        fn set_default_send_library(
            ref self: ComponentState<TContractState>, eid: u32, lib: ContractAddress,
        ) {
            // Only the protocol owner can set default libraries
            self._assert_only_owner();

            // Prevent no-op updates (must provide a different value)
            let old_lib = self.default_send_library.entry(eid).read();
            assert_with_byte_array(old_lib != lib, err_same_value());

            // Validate library registration, type, and endpoint support
            self._assert_registered(lib);
            self._assert_send_lib(lib);
            self._assert_supported_send_eid(lib, eid);

            // Update the default send library for the endpoint
            self.default_send_library.entry(eid).write(lib);
            self.emit(DefaultSendLibrarySet { eid, library: lib });
        }

        fn get_default_send_library(
            self: @ComponentState<TContractState>, eid: u32,
        ) -> ContractAddress {
            self.default_send_library.entry(eid).read()
        }

        // ========================= Receive Library Management =========================

        fn set_receive_library(
            ref self: ComponentState<TContractState>,
            oapp: ContractAddress,
            eid: u32,
            lib: ContractAddress,
            grace_period: u64,
        ) {
            // Only the OApp itself can set its receive library
            self._assert_authorized(oapp);

            let receive_library_entry = self.receive_library.entry(oapp).entry(eid);
            // Prevent no-op updates (must provide new values)
            let old_lib = receive_library_entry.read();
            assert_with_byte_array(old_lib != lib, err_same_value());

            // Validate library registration, type, and endpoint support
            self._assert_registered_or_default(lib);
            self._assert_receive_lib(lib);
            self._assert_supported_receive_eid(lib, eid);

            // Update the receive library configuration
            receive_library_entry.write(lib);
            self.emit(ReceiveLibrarySet { receiver: oapp, src_eid: eid, library: lib });

            if grace_period > 0 {
                // To simplify logic, we only allow timeout if neither new lib nor old lib is
                // DEFAULT_LIB. This prevents complex interactions with default library timeouts.
                assert_with_byte_array(
                    old_lib != DEFAULT_LIB && lib != DEFAULT_LIB, err_only_non_default_lib(),
                );

                // Set grace period for the old library to remain valid during transition
                let timeout = Timeout { lib: old_lib, expiry: get_block_number() + grace_period };
                self.receive_library_timeout.entry(oapp).entry(eid).write(timeout);
                self
                    .emit(
                        ReceiveLibraryTimeoutSet {
                            receiver: oapp, eid, library: old_lib, expiry: timeout.expiry,
                        },
                    );
            } else {
                // Clear any existing timeout when no grace period is specified
                // this writes the default value for Timeout struct
                self.receive_library_timeout.entry(oapp).entry(eid).write(DEFAULT_TIMEOUT);
                self
                    .emit(
                        ReceiveLibraryTimeoutSet {
                            receiver: oapp, eid, library: old_lib, expiry: DEFAULT_EXPIRY,
                        },
                    );
            }
        }

        fn get_receive_library(
            self: @ComponentState<TContractState>, oapp: ContractAddress, src_eid: u32,
        ) -> GetLibraryResponse {
            // Get the OApp's custom receive library configuration
            let lib = self.receive_library.entry(oapp).entry(src_eid).read();

            // If not set or set to DEFAULT_LIB, resolve to the protocol default
            if lib == DEFAULT_LIB {
                let default_lib = self.default_receive_library.entry(src_eid).read();
                assert_with_byte_array(
                    !default_lib.is_zero(), err_default_receive_lib_unavailable(),
                );
                GetLibraryResponse {
                    lib: default_lib, is_default: true,
                } // Return library and indicate it's the default
            } else {
                GetLibraryResponse {
                    lib, is_default: false,
                } // Return custom library and indicate it's not the default
            }
        }

        fn get_raw_receive_library(
            self: @ComponentState<TContractState>, oapp: ContractAddress, src_eid: u32,
        ) -> ContractAddress {
            self.receive_library.entry(oapp).entry(src_eid).read()
        }

        fn is_valid_receive_library(
            self: @ComponentState<TContractState>,
            oapp: ContractAddress,
            src_eid: u32,
            lib: ContractAddress,
        ) -> bool {
            // First check if the lib is the currently configured receive library
            let GetLibraryResponse {
                lib: expected_lib, is_default,
            } = self.get_receive_library(oapp, src_eid);
            if lib == expected_lib {
                return true;
            }

            // If not the current library, check if it's in a valid grace period
            // Use the appropriate timeout configuration based on whether default is being used
            let timeout = if is_default {
                // OApp is using default library, check default timeout configuration
                self.default_receive_library_timeout.entry(src_eid).read()
            } else {
                // OApp has custom library, check OApp-specific timeout configuration
                self.receive_library_timeout.entry(oapp).entry(src_eid).read()
            };

            // Library is valid if it matches the timeout library and hasn't expired
            timeout.lib == lib && timeout.expiry > get_block_number()
        }

        fn set_default_receive_library(
            ref self: ComponentState<TContractState>,
            eid: u32,
            lib: ContractAddress,
            grace_period: u64,
        ) {
            // Only the protocol owner can set default libraries
            self._assert_only_owner();

            // Prevent no-op updates (must provide a different value)
            let old_lib = self.default_receive_library.entry(eid).read();
            assert_with_byte_array(old_lib != lib, err_same_value());

            // Validate library registration, type, and endpoint support
            self._assert_registered(lib);
            self._assert_receive_lib(lib);
            self._assert_supported_receive_eid(lib, eid);

            // Update the default receive library for the endpoint
            self.default_receive_library.entry(eid).write(lib);
            self.emit(DefaultReceiveLibrarySet { eid, library: lib });

            if grace_period > 0 {
                // Set grace period for the old default library to remain valid
                let timeout = Timeout { lib: old_lib, expiry: get_block_number() + grace_period };
                self.default_receive_library_timeout.entry(eid).write(timeout);
                self
                    .emit(
                        DefaultReceiveLibraryTimeoutSet {
                            eid, library: old_lib, expiry: timeout.expiry,
                        },
                    );
            } else {
                // Remove any existing timeout configuration
                // this writes the default value for Timeout struct
                self.default_receive_library_timeout.entry(eid).write(DEFAULT_TIMEOUT);
                self
                    .emit(
                        DefaultReceiveLibraryTimeoutSet {
                            eid, library: old_lib, expiry: DEFAULT_EXPIRY,
                        },
                    );
            }
        }

        fn get_default_receive_library(
            self: @ComponentState<TContractState>, eid: u32,
        ) -> ContractAddress {
            self.default_receive_library.entry(eid).read()
        }

        fn is_default_receive_library(
            self: @ComponentState<TContractState>, oapp: ContractAddress, src_eid: u32,
        ) -> bool {
            self.receive_library.entry(oapp).entry(src_eid).read() == DEFAULT_LIB
        }

        fn set_receive_library_timeout(
            ref self: ComponentState<TContractState>,
            oapp: ContractAddress,
            eid: u32,
            lib: ContractAddress,
            expiry: u64,
        ) {
            // Only the OApp itself can manage its timeout configurations
            self._assert_authorized(oapp);

            // Validate library registration, type, and endpoint support
            self._assert_registered(lib);
            self._assert_receive_lib(lib);
            self._assert_supported_receive_eid(lib, eid);

            let GetLibraryResponse { is_default, .. } = self.get_receive_library(oapp, eid);
            // OApps using default libraries cannot set custom timeouts
            assert_with_byte_array(!is_default, err_only_non_default_lib());

            if expiry > 0 {
                // Set new timeout configuration (expiry must be in the future)
                assert_with_byte_array(expiry > get_block_number(), err_invalid_expiry());
                let timeout = Timeout { lib, expiry };
                self.receive_library_timeout.entry(oapp).entry(eid).write(timeout);
            } else {
                // Remove the timeout configuration (force expire)
                self.receive_library_timeout.entry(oapp).entry(eid).write(DEFAULT_TIMEOUT);
            }
            self.emit(ReceiveLibraryTimeoutSet { receiver: oapp, eid, library: lib, expiry });
        }

        fn get_receive_library_timeout(
            self: @ComponentState<TContractState>, oapp: ContractAddress, eid: u32,
        ) -> Timeout {
            self.receive_library_timeout.entry(oapp).entry(eid).read()
        }

        fn set_default_receive_library_timeout(
            ref self: ComponentState<TContractState>, eid: u32, lib: ContractAddress, expiry: u64,
        ) {
            // Only the protocol owner can manage default timeout configurations
            self._assert_only_owner();

            // Validate library registration, type, and endpoint support
            self._assert_registered(lib);
            self._assert_receive_lib(lib);
            self._assert_supported_receive_eid(lib, eid);

            if expiry > 0 {
                // Set new default timeout configuration (expiry must be in the future)
                assert_with_byte_array(expiry > get_block_number(), err_invalid_expiry());
                let timeout = Timeout { lib, expiry };
                self.default_receive_library_timeout.entry(eid).write(timeout);
            } else {
                // Remove the default timeout configuration (force expire)
                self.default_receive_library_timeout.entry(eid).write(DEFAULT_TIMEOUT);
            }
            self.emit(DefaultReceiveLibraryTimeoutSet { eid, library: lib, expiry });
        }

        fn get_default_receive_library_timeout(
            self: @ComponentState<TContractState>, eid: u32,
        ) -> Timeout {
            self.default_receive_library_timeout.entry(eid).read()
        }

        // ========================= Configuration Management =========================

        fn set_send_configs(
            ref self: ComponentState<TContractState>,
            oapp: ContractAddress,
            lib: ContractAddress,
            params: Array<SetConfigParam>,
        ) {
            // Only the OApp itself can set its send configuration
            self._assert_authorized(oapp);

            self._assert_registered(lib);
            self._assert_send_lib(lib);

            let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
            lib_dispatcher.set_send_configs(oapp, params);
        }

        fn set_receive_configs(
            ref self: ComponentState<TContractState>,
            oapp: ContractAddress,
            lib: ContractAddress,
            params: Array<SetConfigParam>,
        ) {
            // Only the OApp itself can set its receive configuration
            self._assert_authorized(oapp);

            self._assert_registered(lib);
            self._assert_receive_lib(lib);

            let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
            lib_dispatcher.set_receive_configs(oapp, params);
        }

        fn get_send_config(
            self: @ComponentState<TContractState>,
            oapp: ContractAddress,
            lib: ContractAddress,
            eid: u32,
            config_type: u32,
        ) -> Array<felt252> {
            // Only registered libraries can provide configuration
            self._assert_registered(lib);
            self._assert_send_lib(lib);

            // Delegate configuration query to the message library
            let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
            lib_dispatcher.get_send_config(eid, oapp, config_type)
        }

        fn get_receive_config(
            self: @ComponentState<TContractState>,
            oapp: ContractAddress,
            lib: ContractAddress,
            eid: u32,
            config_type: u32,
        ) -> Array<felt252> {
            // Only registered libraries can provide configuration
            self._assert_registered(lib);
            self._assert_receive_lib(lib);

            let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
            lib_dispatcher.get_receive_config(eid, oapp, config_type)
        }

        // ========================= Utility Functions =========================

        fn is_supported_eid(self: @ComponentState<TContractState>, eid: u32) -> bool {
            // An endpoint is considered supported if it has both default send and receive libraries
            let default_send = self.default_send_library.entry(eid).read();
            let default_receive = self.default_receive_library.entry(eid).read();
            !default_send.is_zero() && !default_receive.is_zero()
        }
    }

    /// =============================== Internal Functions =================================
    #[generate_trait]
    pub impl InternalImpl<
        TContractState,
        +HasComponent<TContractState>,
        impl Ownable: OwnableComponent::HasComponent<TContractState>,
        +Drop<TContractState>,
    > of InternalTrait<TContractState> {
        /// Initialize the MessageLibManager component with a blocked library
        ///
        /// The blocked library is automatically registered and serves as a way to
        /// disable sending/receiving on specific endpoints by setting it as the default.
        ///
        /// # Arguments
        /// * `blocked_library` - Address of the library that blocks operations
        fn initializer(ref self: ComponentState<TContractState>, blocked_library: ContractAddress) {
            // Query the library for its type to ensure it implements IMessageLib.
            let lib_dispatcher = IMessageLibDispatcher { contract_address: blocked_library };
            let _ = lib_dispatcher.message_lib_type();

            self.blocked_library.write(blocked_library);

            // Register blocked library directly without owner check during initialization
            self.is_registered_library.entry(blocked_library).write(true);
            self.registered_libraries.push(blocked_library);
            self.emit(LibraryRegistered { library: blocked_library });
        }

        /// Assert that the caller is the contract owner
        ///
        /// Uses the Ownable component to verify ownership permissions.
        /// Used for operations that require protocol-level administrative access.
        fn _assert_only_owner(self: @ComponentState<TContractState>) {
            let ownable = get_dep_component!(self, Ownable);
            ownable.assert_only_owner();
        }

        /// Assert that a library is registered with the endpoint
        ///
        /// # Arguments
        /// * `lib` - The library address to validate
        ///
        /// # Panics
        /// * If the library is not registered
        fn _assert_registered(self: @ComponentState<TContractState>, lib: ContractAddress) {
            assert_with_byte_array(
                self.is_registered_library.entry(lib).read(), err_only_registered_lib(),
            );
        }

        /// Assert that a library is registered or is the DEFAULT_LIB constant
        ///
        /// This allows functions to accept either a registered library or the special
        /// DEFAULT_LIB value that indicates the default library should be used.
        ///
        /// # Arguments
        /// * `lib` - The library address to validate
        ///
        /// # Panics
        /// * If the library is not registered and is not DEFAULT_LIB
        fn _assert_registered_or_default(
            self: @ComponentState<TContractState>, lib: ContractAddress,
        ) {
            if lib != DEFAULT_LIB {
                assert_with_byte_array(
                    self.is_registered_library.entry(lib).read(),
                    err_only_registered_or_default_lib(),
                );
            }
        }

        /// Assert that a library supports send operations
        ///
        /// Validates that the library's type is either Send or SendAndReceive.
        /// Skips validation for DEFAULT_LIB as it will be resolved later.
        ///
        /// # Arguments
        /// * `lib` - The library address to validate
        ///
        /// # Panics
        /// * If the library doesn't support send operations
        fn _assert_send_lib(self: @ComponentState<TContractState>, lib: ContractAddress) {
            if lib != DEFAULT_LIB {
                let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
                let lib_type = lib_dispatcher.message_lib_type();
                assert_with_byte_array(
                    lib_type == MessageLibType::Send || lib_type == MessageLibType::SendAndReceive,
                    err_only_send_lib(),
                );
            }
        }

        /// Assert that a library supports receive operations
        ///
        /// Validates that the library's type is either Receive or SendAndReceive.
        /// Skips validation for DEFAULT_LIB as it will be resolved later.
        ///
        /// # Arguments
        /// * `lib` - The library address to validate
        ///
        /// # Panics
        /// * If the library doesn't support receive operations
        fn _assert_receive_lib(self: @ComponentState<TContractState>, lib: ContractAddress) {
            if lib != DEFAULT_LIB {
                let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
                let lib_type = lib_dispatcher.message_lib_type();
                assert_with_byte_array(
                    lib_type == MessageLibType::Receive
                        || lib_type == MessageLibType::SendAndReceive,
                    err_only_receive_lib(),
                );
            }
        }

        /// Assert that a library supports operations for a specific endpoint
        ///
        /// Validates that the library has enabled support for the given endpoint ID.
        /// This ensures libraries can only be used for endpoints they're designed to handle.
        /// Skips validation for DEFAULT_LIB as it will be resolved later.
        ///
        /// # Arguments
        /// * `lib` - The library address to validate
        /// * `eid` - The endpoint ID to check support for
        ///
        /// # Panics
        /// * If the library doesn't support the specified endpoint
        fn _assert_supported_send_eid(
            self: @ComponentState<TContractState>, lib: ContractAddress, eid: u32,
        ) {
            if lib != DEFAULT_LIB {
                let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
                assert_with_byte_array(
                    lib_dispatcher.is_supported_send_eid(eid), err_unsupported_eid(eid),
                );
            }
        }

        fn _assert_supported_receive_eid(
            self: @ComponentState<TContractState>, lib: ContractAddress, eid: u32,
        ) {
            if lib != DEFAULT_LIB {
                let lib_dispatcher = IMessageLibDispatcher { contract_address: lib };
                assert_with_byte_array(
                    lib_dispatcher.is_supported_receive_eid(eid), err_unsupported_eid(eid),
                );
            }
        }
    }
}
