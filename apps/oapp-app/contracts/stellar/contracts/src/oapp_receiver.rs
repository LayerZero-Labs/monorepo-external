use crate::{
    errors::OAppError,
    oapp_core::{endpoint_client, get_peer_or_panic, OAppCore},
};
use common_macros::contract_trait;
use endpoint_v2::Origin;
use soroban_sdk::{assert_with_error, token::TokenClient, Address, Bytes, BytesN, Env};

/// The version of the OAppReceiver implementation.
/// Version is bumped when changes are made to this contract.
pub const RECEIVER_VERSION: u64 = 1;

// =====================================================
// LzReceiveInternal Trait
// =====================================================

/// Application-specific handler for incoming LayerZero messages.
///
/// Implement this trait to define how your OApp processes cross-chain messages.
/// The default `OAppReceiver::lz_receive` calls `clear_payload_and_transfer` first,
/// then delegates to your `__lz_receive` implementation.
///
/// **Important:** Do NOT call `clear_payload_and_transfer` in your implementation -
/// it is handled automatically by the default `lz_receive`.
pub trait LzReceiveInternal {
    /// Processes a verified cross-chain message.
    ///
    /// Called after payload verification. Implement your message handling logic here.
    fn __lz_receive(
        env: &Env,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        executor: &Address,
        value: i128,
    );
}

// =====================================================
// OAppReceiver Trait
// =====================================================

/// Receiver trait for OApps that accept cross-chain messages from LayerZero.
///
/// Mirrors `ILayerZeroReceiver` function signatures, allowing the executor to call
/// these methods via `LayerZeroReceiverClient`.
///
/// # Default Implementations
/// | Method                   | Behavior                                                       |
/// |--------------------------|----------------------------------------------------------------|
/// | `allow_initialize_path`  | Returns true if origin sender matches configured peer          |
/// | `next_nonce`             | Returns 0 (unordered delivery)                                 |
/// | `lz_receive`             | Verifies payload, then calls `LzReceiveInternal::__lz_receive` |
/// | `is_compose_msg_sender`  | Returns true if sender is current contract                     |
///
/// # Usage
///
/// ```ignore
/// use oapp::oapp_receiver::LzReceiveInternal;
///
/// #[common_macros::lz_contract]
/// #[oapp_macros::oapp]
/// pub struct MyOApp;
///
/// impl LzReceiveInternal for MyOApp {
///     fn __lz_receive(env: &Env, origin: &Origin, guid: &BytesN<32>,
///                     message: &Bytes, extra_data: &Bytes, executor: &Address, value: i128) {
///         // Your message handling logic here
///     }
/// }
/// ```
///
/// # Customization
/// For custom behavior (e.g., ordered nonce enforcement), use `#[oapp(custom = [receiver])]`
/// and implement both `LzReceiveInternal` and `OAppReceiver`.
#[contract_trait]
pub trait OAppReceiver: OAppCore + LzReceiveInternal {
    /// Checks if a messaging path can be initialized for the given origin.
    ///
    /// # Arguments
    /// * `origin` - The origin of the message
    ///
    /// # Returns
    /// True if the path can be initialized, false otherwise
    fn allow_initialize_path(env: &soroban_sdk::Env, origin: &endpoint_v2::Origin) -> bool {
        let peer = Self::peer(env, origin.src_eid);
        peer.is_some_and(|peer| peer == origin.sender)
    }

    /// Retrieves the next nonce for a given source endpoint and sender address.
    ///
    /// The path nonce starts from 1. If 0 is returned it means that there is NO nonce ordered enforcement.
    /// This is required by the off-chain executor to determine if the OApp expects message execution to be ordered.
    /// This is also enforced by the OApp.
    /// By default this is NOT enabled, i.e. next_nonce is hardcoded to return 0.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address
    ///
    /// # Returns
    /// The next nonce
    fn next_nonce(_env: &soroban_sdk::Env, _src_eid: u32, _sender: &soroban_sdk::BytesN<32>) -> u64 {
        0
    }

    /// Entry point for receiving messages or packets from the LayerZero endpoint.
    ///
    /// The default implementation calls `clear_payload_and_transfer` to validate the message
    /// and clear it from the endpoint, then delegates to `__lz_receive` for application logic.
    ///
    /// # Arguments
    /// * `executor` - The address of the executor for the received message
    /// * `origin` - The origin information containing the source endpoint and sender address:
    ///   - `src_eid`: The source endpoint ID
    ///   - `sender`: The sender address on the source chain
    ///   - `nonce`: The nonce of the message
    /// * `guid` - The unique identifier for the received LayerZero message
    /// * `message` - The payload of the received message
    /// * `extra_data` - Additional arbitrary data provided by the corresponding executor
    /// * `value` - The native token value sent with the message
    fn lz_receive(
        env: &soroban_sdk::Env,
        executor: &soroban_sdk::Address,
        origin: &endpoint_v2::Origin,
        guid: &soroban_sdk::BytesN<32>,
        message: &soroban_sdk::Bytes,
        extra_data: &soroban_sdk::Bytes,
        value: i128,
    ) {
        clear_payload_and_transfer::<Self>(env, executor, origin, guid, message, value);
        Self::__lz_receive(env, origin, guid, message, extra_data, executor, value)
    }

    /// Indicates whether an address is an approved composeMsg sender to the Endpoint.
    ///
    /// Applications can optionally choose to implement separate composeMsg senders that are NOT the bridging layer.
    /// The default sender IS the OAppReceiver implementer.
    ///
    /// # Arguments
    /// * `origin` - The origin information containing the source endpoint and sender address
    /// * `message` - The lzReceive payload
    /// * `sender` - The sender address to check
    ///
    /// # Returns
    /// True if the sender is a valid composeMsg sender, false otherwise
    fn is_compose_msg_sender(
        env: &soroban_sdk::Env,
        _origin: &endpoint_v2::Origin,
        _message: &soroban_sdk::Bytes,
        sender: &soroban_sdk::Address,
    ) -> bool {
        env.current_contract_address() == *sender
    }
}

// =====================================================
// Helper functions
// =====================================================

/// Clears the message payload from the endpoint and transfers native tokens from the executor to the oapp if has value.
///
/// # Arguments
/// * `env` - The environment
/// * `executor` - The address of the executor delivering the message
/// * `origin` - The origin information (source EID, sender, nonce)
/// * `guid` - The unique identifier for the LayerZero message to clear the payload from
/// * `message` - The message payload to clear
/// * `value` - The native token value to transfer from the executor to the oapp if has value
pub fn clear_payload_and_transfer<T: OAppCore>(
    env: &Env,
    executor: &Address,
    origin: &Origin,
    guid: &BytesN<32>,
    message: &Bytes,
    value: i128,
) {
    // Require authorization from the executor and transfer the value from the executor to the oapp if has value
    executor.require_auth();
    // Assert that the message is from the expected peer
    assert_with_error!(env, get_peer_or_panic::<T>(env, origin.src_eid) == origin.sender, OAppError::OnlyPeer);

    let this_address = env.current_contract_address();
    let endpoint_client = endpoint_client::<T>(env);

    // Transfer the value from the executor to the oapp if has value
    if value != 0 {
        let token_client = TokenClient::new(env, &endpoint_client.native_token());
        token_client.transfer(executor, &this_address, &value);
    }

    // Clear the message payload from the endpoint
    endpoint_client.clear(&this_address, origin, &this_address, guid, message);
}
