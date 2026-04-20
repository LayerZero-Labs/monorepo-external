use super::{EndpointV2, EndpointV2Args, EndpointV2Client};
use crate::{
    errors::EndpointError,
    events::{
        DefaultReceiveLibTimeoutSet, DefaultReceiveLibrarySet, DefaultSendLibrarySet, LibraryRegistered,
        ReceiveLibrarySet, ReceiveLibraryTimeoutSet, SendLibrarySet,
    },
    interfaces::IMessageLibManager,
    storage::EndpointStorage,
    MessageLibClient, MessageLibType, ResolvedLibrary, SetConfigParam, Timeout,
};
use common_macros::{contract_impl, only_auth};
use soroban_sdk::{assert_with_error, vec, Address, Bytes, Env, Vec};
use utils::option_ext::OptionExt;

#[contract_impl]
impl IMessageLibManager for EndpointV2 {
    /// Registers a new message library with the endpoint.
    #[only_auth]
    fn register_library(env: &Env, new_lib: &Address) {
        // Call library get type to make sure it's a valid library, will panic if not
        let _ = MessageLibClient::new(env, new_lib).message_lib_type();

        // Check if the library is already registered
        assert_with_error!(&env, !Self::is_registered_library(env, new_lib), EndpointError::AlreadyRegistered);

        // Register the library
        let index = Self::registered_libraries_count(env);
        EndpointStorage::set_library_to_index(env, new_lib, &index);
        EndpointStorage::set_index_to_library(env, index, new_lib);
        EndpointStorage::set_registered_libraries_count(env, &(index + 1)); // increment the registered library count

        LibraryRegistered { new_lib: new_lib.clone() }.publish(env);
    }

    /// Sets the default send library for a destination endpoint.
    #[only_auth]
    fn set_default_send_library(env: &Env, dst_eid: u32, new_lib: &Address) {
        Self::require_send_lib_for_eid(env, new_lib, dst_eid);

        let old_lib = Self::default_send_library(env, dst_eid);
        assert_with_error!(env, old_lib.as_ref() != Some(new_lib), EndpointError::SameValue);

        EndpointStorage::set_default_send_library(env, dst_eid, new_lib);
        DefaultSendLibrarySet { dst_eid, new_lib: new_lib.clone() }.publish(env);
    }

    /// Sets the default receive library for a source endpoint.
    ///
    /// If a grace period is provided and there was a previous library, the old library
    /// remains valid until the grace period expires.
    #[only_auth]
    fn set_default_receive_library(env: &Env, src_eid: u32, new_lib: &Address, grace_period: u64) {
        Self::require_receive_lib_for_eid(env, new_lib, src_eid);

        let old_lib = Self::default_receive_library(env, src_eid);
        assert_with_error!(env, old_lib.as_ref() != Some(new_lib), EndpointError::SameValue);

        EndpointStorage::set_default_receive_library(env, src_eid, new_lib);
        DefaultReceiveLibrarySet { src_eid, new_lib: new_lib.clone() }.publish(env);

        // Set timeout based on grace period and old library
        let timeout = if grace_period > 0 {
            old_lib.map(|lib| {
                let expiry = env.ledger().timestamp() + grace_period;
                Timeout { lib, expiry }
            })
        } else {
            None
        };
        EndpointStorage::set_or_remove_default_receive_library_timeout(env, src_eid, &timeout);
        DefaultReceiveLibTimeoutSet { src_eid, timeout: timeout.clone() }.publish(env);
    }

    /// Sets or removes the default receive library timeout for a source endpoint.
    ///
    /// If a timeout is provided, it must be valid and not expired. If no timeout is provided,
    /// the default receive library timeout is removed.
    #[only_auth]
    fn set_default_receive_lib_timeout(env: &Env, src_eid: u32, timeout: &Option<Timeout>) {
        if let Some(t) = timeout {
            Self::require_receive_lib_for_eid(env, &t.lib, src_eid);
            assert_with_error!(env, !t.is_expired(env), EndpointError::InvalidExpiry);
        }
        EndpointStorage::set_or_remove_default_receive_library_timeout(env, src_eid, timeout);
        DefaultReceiveLibTimeoutSet { src_eid, timeout: timeout.clone() }.publish(env);
    }

    // ============================================================================================
    // OApp Control Functions
    // ============================================================================================

    /// Sets or removes a custom send library for an OApp to a specific destination endpoint.
    fn set_send_library(env: &Env, caller: &Address, sender: &Address, dst_eid: u32, new_lib: &Option<Address>) {
        Self::require_oapp_auth(env, caller, sender);

        let old_lib = EndpointStorage::send_library(env, sender, dst_eid);
        assert_with_error!(env, &old_lib != new_lib, EndpointError::SameValue);

        if let Some(lib) = new_lib {
            Self::require_send_lib_for_eid(env, lib, dst_eid);
        }
        EndpointStorage::set_or_remove_send_library(env, sender, dst_eid, new_lib);
        SendLibrarySet { sender: sender.clone(), dst_eid, new_lib: new_lib.clone() }.publish(env);
    }

    /// Sets or removes a custom receive library for an OApp to a specific source endpoint.
    ///
    /// If a grace period is provided and there was a previous library, the old library
    /// remains valid until the grace period expires.
    fn set_receive_library(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        new_lib: &Option<Address>,
        grace_period: u64,
    ) {
        Self::require_oapp_auth(env, caller, receiver);

        let old_lib = EndpointStorage::receive_library(env, receiver, src_eid);
        assert_with_error!(env, &old_lib != new_lib, EndpointError::SameValue);

        if let Some(lib) = new_lib {
            Self::require_receive_lib_for_eid(env, lib, src_eid);
        }
        EndpointStorage::set_or_remove_receive_library(env, receiver, src_eid, new_lib);
        ReceiveLibrarySet { receiver: receiver.clone(), src_eid, new_lib: new_lib.clone() }.publish(env);

        // Set timeout based on grace period and library availability
        let timeout = if grace_period > 0 {
            // To simplify timeout logic, we only allow setting timeout when both old and new libraries are custom (non-default).
            // This avoids complex interactions with default library timeout configurations.
            //
            // For other scenarios:
            // (1) To fall back to default library: set new_lib to None with grace_period = 0
            // (2) To change from default to custom library: set new_lib to custom with grace_period = 0,
            //     then use set_receive_library_timeout() to configure timeout separately if needed
            assert_with_error!(env, old_lib.is_some() && new_lib.is_some(), EndpointError::OnlyNonDefaultLib);
            Some(Timeout { lib: old_lib.unwrap(), expiry: env.ledger().timestamp() + grace_period })
        } else {
            None
        };

        EndpointStorage::set_or_remove_receive_library_timeout(env, receiver, src_eid, &timeout);
        ReceiveLibraryTimeoutSet { receiver: receiver.clone(), eid: src_eid, timeout }.publish(env);
    }

    /// Sets or removes the custom receive library timeout for an OApp.
    ///
    /// Allows an OApp to extend or remove the validity period of a previously set library
    /// after switching to a new one.
    fn set_receive_library_timeout(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        timeout: &Option<Timeout>,
    ) {
        Self::require_oapp_auth(env, caller, receiver);

        // OApp can only set timeout for non-default receive libraries
        let ResolvedLibrary { lib: _, is_default } = Self::get_receive_library(env, receiver, src_eid);
        assert_with_error!(env, !is_default, EndpointError::OnlyNonDefaultLib);

        if let Some(t) = timeout {
            Self::require_receive_lib_for_eid(env, &t.lib, src_eid);
            assert_with_error!(env, !t.is_expired(env), EndpointError::InvalidExpiry);
        }
        EndpointStorage::set_or_remove_receive_library_timeout(env, receiver, src_eid, timeout);
        ReceiveLibraryTimeoutSet { receiver: receiver.clone(), eid: src_eid, timeout: timeout.clone() }.publish(env);
    }

    /// Sets the configuration for a message library.
    ///
    /// Requires the caller to be the OApp or its delegate and the library to be registered.
    fn set_config(env: &Env, caller: &Address, oapp: &Address, lib: &Address, params: &Vec<SetConfigParam>) {
        Self::require_oapp_auth(env, caller, oapp);
        Self::require_registered(env, lib);

        MessageLibClient::new(env, lib).set_config(oapp, params);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    /// Checks if a message library is registered.
    fn is_registered_library(env: &Env, lib: &Address) -> bool {
        EndpointStorage::has_library_to_index(env, lib)
    }

    /// Returns the index of a message library.
    fn get_library_index(env: &Env, lib: &Address) -> Option<u32> {
        EndpointStorage::library_to_index(env, lib)
    }

    /// Returns the number of registered message libraries.
    fn registered_libraries_count(env: &Env) -> u32 {
        EndpointStorage::registered_libraries_count(env)
    }

    /// Returns a list of registered message libraries within the specified range.
    fn get_registered_libraries(env: &Env, start: u32, max_count: u32) -> Vec<Address> {
        let count = EndpointStorage::registered_libraries_count(env);
        if count == 0 || start >= count {
            return vec![env];
        }

        let end = count.min(start + max_count);
        let mut libraries = vec![env];
        libraries.extend((start..end).map(|i| EndpointStorage::index_to_library(env, i).unwrap()));
        libraries
    }

    /// Checks if an endpoint ID is supported.
    /// Returns true only if both the default send/receive libraries are set for the given eid
    fn is_supported_eid(env: &Env, eid: u32) -> bool {
        EndpointStorage::has_default_send_library(env, eid) && EndpointStorage::has_default_receive_library(env, eid)
    }

    /// Returns the default send library for a destination endpoint.
    fn default_send_library(env: &Env, dst_eid: u32) -> Option<Address> {
        EndpointStorage::default_send_library(env, dst_eid)
    }

    /// Returns the default receive library for a source endpoint.
    fn default_receive_library(env: &Env, src_eid: u32) -> Option<Address> {
        EndpointStorage::default_receive_library(env, src_eid)
    }

    /// Returns the default receive library timeout for a source endpoint.
    fn default_receive_library_timeout(env: &Env, src_eid: u32) -> Option<Timeout> {
        EndpointStorage::default_receive_library_timeout(env, src_eid)
    }

    // ============================================================================================
    // OApp View Functions
    // ============================================================================================

    /// Returns the effective send library for an OApp and destination endpoint.
    fn get_send_library(env: &Env, sender: &Address, dst_eid: u32) -> ResolvedLibrary {
        EndpointStorage::send_library(env, sender, dst_eid)
            .map(|lib| ResolvedLibrary { lib, is_default: false })
            .unwrap_or_else(|| {
                let default_lib = EndpointStorage::default_send_library(env, dst_eid)
                    .unwrap_or_panic(env, EndpointError::DefaultSendLibUnavailable);
                ResolvedLibrary { lib: default_lib, is_default: true }
            })
    }

    /// Returns the effective receive library for an OApp and source endpoint.
    fn get_receive_library(env: &Env, receiver: &Address, src_eid: u32) -> ResolvedLibrary {
        EndpointStorage::receive_library(env, receiver, src_eid)
            .map(|lib| ResolvedLibrary { lib, is_default: false })
            .unwrap_or_else(|| {
                let default_lib = EndpointStorage::default_receive_library(env, src_eid)
                    .unwrap_or_panic(env, EndpointError::DefaultReceiveLibUnavailable);
                ResolvedLibrary { lib: default_lib, is_default: true }
            })
    }

    /// Returns the receive library timeout for an OApp and source endpoint.
    fn receive_library_timeout(env: &Env, receiver: &Address, src_eid: u32) -> Option<Timeout> {
        EndpointStorage::receive_library_timeout(env, receiver, src_eid)
    }

    /// Checks if a receive library is valid for an OApp and source endpoint.
    fn is_valid_receive_library(env: &Env, receiver: &Address, src_eid: u32, actual_lib: &Address) -> bool {
        // early return true if the lib is the currently configured one
        let ResolvedLibrary { lib: expected_lib, is_default } = Self::get_receive_library(env, receiver, src_eid);
        if actual_lib == &expected_lib {
            return true;
        }

        // Check if the actual_lib matches a timeout library that hasn't expired
        let timeout = if is_default {
            Self::default_receive_library_timeout(env, src_eid)
        } else {
            Self::receive_library_timeout(env, receiver, src_eid)
        };

        timeout.is_some_and(|t| t.is_valid_for(env, actual_lib))
    }

    /// Returns the configuration for a message library for a specific endpoint ID and configuration type.
    fn get_config(env: &Env, oapp: &Address, lib: &Address, eid: u32, config_type: u32) -> Bytes {
        Self::require_registered(env, lib);
        MessageLibClient::new(env, lib).get_config(&eid, oapp, &config_type)
    }
}

// ============================================================================================
// Internal Functions
// ============================================================================================

impl EndpointV2 {
    /// Requires a message library to be registered.
    fn require_registered(env: &Env, lib: &Address) {
        assert_with_error!(env, Self::is_registered_library(env, lib), EndpointError::OnlyRegisteredLib);
    }

    /// Requires an endpoint ID to be supported.
    fn require_supported_eid(env: &Env, lib: &Address, eid: u32) {
        let is_supported = MessageLibClient::new(env, lib).is_supported_eid(&eid);
        assert_with_error!(env, is_supported, EndpointError::UnsupportedEid);
    }

    /// Requires a library to be a registered send library and supported for the given endpoint ID.
    fn require_send_lib_for_eid(env: &Env, lib: &Address, eid: u32) {
        Self::require_registered(env, lib);

        let message_lib_type = MessageLibClient::new(env, lib).message_lib_type();
        assert_with_error!(
            env,
            message_lib_type == MessageLibType::Send || message_lib_type == MessageLibType::SendAndReceive,
            EndpointError::OnlySendLib
        );

        Self::require_supported_eid(env, lib, eid);
    }

    /// Requires a library to be a registered receive library and supported for the given endpoint ID.
    fn require_receive_lib_for_eid(env: &Env, lib: &Address, eid: u32) {
        Self::require_registered(env, lib);

        let message_lib_type = MessageLibClient::new(env, lib).message_lib_type();
        assert_with_error!(
            env,
            message_lib_type == MessageLibType::Receive || message_lib_type == MessageLibType::SendAndReceive,
            EndpointError::OnlyReceiveLib
        );

        Self::require_supported_eid(env, lib, eid);
    }
}

// ============================================================================
// Test-only Functions
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;

    impl EndpointV2 {
        /// Test-only wrapper for require_registered.
        pub fn require_registered_for_test(env: &Env, lib: &Address) {
            Self::require_registered(env, lib)
        }

        /// Test-only wrapper for require_supported_eid.
        pub fn require_supported_eid_for_test(env: &Env, lib: &Address, eid: u32) {
            Self::require_supported_eid(env, lib, eid)
        }

        /// Test-only wrapper for require_send_lib_for_eid.
        pub fn require_send_lib_for_eid_for_test(env: &Env, lib: &Address, eid: u32) {
            Self::require_send_lib_for_eid(env, lib, eid)
        }

        /// Test-only wrapper for require_receive_lib_for_eid.
        pub fn require_receive_lib_for_eid_for_test(env: &Env, lib: &Address, eid: u32) {
            Self::require_receive_lib_for_eid(env, lib, eid)
        }
    }
}
