//! Messaging composer interface

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

/// # `IMessagingComposer` Interface
///
/// The `IMessagingComposer` manages compose payloads that are sent after a LayerZero message has
/// been delivered.
///
/// ## Key features
/// - Queueing of compose payloads by the originating OApp
/// - Verified delivery of compose payloads to a target contract
/// - Optional value transfer (ERC20) to the target prior to callback
/// - Alerting hooks for off-chain/executor reporting
/// - Introspection of the compose queue state
#[starknet::interface]
pub trait IMessagingComposer<TContractState> {
    /// Queue a compose payload for later delivery
    ///
    /// Records the keccak hash of `message` keyed by (sender, `to`, `guid`, `index`).
    /// A corresponding delivery will be executed via `lz_compose` by an executor.
    ///
    /// # Arguments
    /// * `to` - Target contract that will receive the compose callback
    /// * `guid` - Unique identifier of the original LayerZero message
    /// * `index` - Compose index associated with the original message
    /// * `message` - Opaque compose payload
    ///
    /// # Emits
    /// * ComposeSent
    ///
    /// # Panics
    /// * If a compose payload is already queued for the given (sender, `to`, `guid`, `index`)
    fn send_compose(
        ref self: TContractState,
        to: ContractAddress,
        guid: Bytes32,
        index: u16,
        message: ByteArray,
    );

    /// Deliver a previously queued compose payload to the target contract
    ///
    /// Verifies that the provided `message` matches the queued hash, marks the
    /// compose as received to prevent reentrancy, optionally transfers compose
    /// value (ERC20) from the executor to `to`, then calls `ILayerZeroComposer.lz_compose`.
    ///
    /// Note: The caller is expected to be the executor. Do not assume `from == caller`.
    ///
    /// # Arguments
    /// * `from` - Originating OApp that queued the compose on source chain
    /// * `to` - Target contract that implements `ILayerZeroComposer`
    /// * `guid` - Unique identifier of the original LayerZero message
    /// * `index` - Compose index associated with the original message
    /// * `message` - Compose payload; must match the queued hash
    /// * `extra_data` - Executor-provided metadata (protocol-opaque)
    /// * `value` - Amount of compose token to transfer to `to` prior to callback
    ///
    /// # Emits
    /// * ComposeDelivered
    ///
    /// # Panics
    /// * If no compose is found or the hash does not match
    /// * If `value > 0` and executor allowance is insufficient
    fn lz_compose(
        ref self: TContractState,
        from: ContractAddress,
        to: ContractAddress,
        guid: Bytes32,
        index: u16,
        message: ByteArray,
        extra_data: ByteArray,
        value: u256,
    );

    /// Report an alert related to compose execution
    ///
    /// Allows the executor to emit a structured alert event that associates
    /// telemetry or failure information with a compose attempt. Does not modify
    /// queue state.
    ///
    /// # Arguments
    /// * `from` - Originating OApp
    /// * `to` - Target contract
    /// * `guid` - Message GUID
    /// * `index` - Compose index
    /// * `gas` - Gas usage or gas limit context provided by the executor
    /// * `value` - Intended compose token value
    /// * `message` - Compose payload (for correlation)
    /// * `extra_data` - Executor-provided metadata
    /// * `reason` - Opaque reason for the alert
    ///
    /// # Emits
    /// * LzComposeAlert
    fn lz_compose_alert(
        ref self: TContractState,
        from: ContractAddress,
        to: ContractAddress,
        guid: Bytes32,
        index: u16,
        gas: u256,
        value: u256,
        message: ByteArray,
        extra_data: ByteArray,
        reason: Array<felt252>,
    );

    /// Inspect the compose queue
    ///
    /// Returns the stored value for a compose entry keyed by (`sender`, `to`, `guid`, `index`).
    /// Semantics of the returned `Bytes32`:
    /// - `0` — no compose queued
    /// - `1` — compose has been delivered (RECEIVED_MESSAGE_HASH)
    /// - otherwise — keccak hash of the queued `message`
    ///
    /// # Arguments
    /// * `from` - Originating OApp that called `send_compose`
    /// * `to` - Target contract
    /// * `guid` - Message GUID
    /// * `index` - Compose index
    ///
    /// # Returns
    /// * `Bytes32` - Encoded queue state or message hash as described above
    fn get_compose_queue(
        self: @TContractState,
        from: ContractAddress,
        to: ContractAddress,
        guid: Bytes32,
        index: u16,
    ) -> Bytes32;
}
