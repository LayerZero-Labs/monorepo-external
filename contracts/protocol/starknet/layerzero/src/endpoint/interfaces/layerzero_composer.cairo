//! LayerZero composer interface

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

/// # `ILayerZeroComposer` Interface
///
/// The `ILayerZeroComposer` interface is responsible for receiving and processing compose payloads
/// from LayerZero messages.
/// It provides a function for handling the compose request and verifying the payload before
/// executing it.
///
/// ## Key Features
/// - **Compose Handling**: Receives and processes compose payloads from LayerZero messages.
/// - **Verification**: Verifies the compose request and payload before executing it.
/// - **Security**: Ensures that only valid compose requests are processed.
///
/// Contracts that wish to receive compose payloads must implement this
/// interface. The endpoint's `MessagingComposer` component verifies the
/// compose request and then invokes `lz_compose` on the target contract.
///
/// ## High-level flow
/// - An OApp on the source chain requests a compose to a target contract
///   on the destination chain
/// - The destination endpoint's `MessagingComposer` validates the request,
///   prevents reentrancy by marking the message as received, and, if
///   `value > 0`, transfers the configured compose token to the target
///   contract before calling `lz_compose`
/// - The target contract handles the payload in `lz_compose`
#[starknet::interface]
pub trait ILayerZeroComposer<TContractState> {
    /// Receives a compose payload for a previously delivered LayerZero message
    ///
    /// This function is called by the endpoint's `MessagingComposer` after it
    /// has verified the compose request and optionally transferred value to
    /// this contract. Implementations must not assume that the caller equals
    /// `from`; the caller is the executor that relayed the compose.
    ///
    /// # Arguments
    /// * `from` - The originating OApp address that initiated the compose on the
    ///            source chain
    /// * `guid` - Globally unique identifier of the original LayerZero message
    /// * `message` - Opaque compose payload provided by the sender
    /// * `executor` - The contract address that executed the compose on-chain
    /// * `extra_data` - Additional metadata from the executor (e.g., execution
    ///                  context or options); protocol-opaque
    /// * `value` - Amount of compose token that was transferred to this
    ///            contract immediately before this call (0 if none)
    ///
    /// # Panics
    /// * Implementation-defined. Implementations should revert if the payload is invalid for this
    /// contract or if execution preconditions are not met.
    fn lz_compose(
        ref self: TContractState,
        from: ContractAddress,
        guid: Bytes32,
        message: ByteArray,
        executor: ContractAddress,
        extra_data: ByteArray,
        value: u256,
    );
}
