//! EndpointV2 interface

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::MessagingFee;
use crate::common::structs::messaging::{MessageReceipt, MessagingParams};
use crate::common::structs::packet::Origin;

/// # `IEndpointV2` Interface
///
/// The `IEndpointV2` interface is the central component of the LayerZero protocol, designed to
/// facilitate seamless, secure, and efficient cross-chain messaging. As the primary entry point for
/// all LayerZero messages, the EndpointV2 contract manages the entire lifecycle of a message, from
/// sending to receiving, while ensuring reliable delivery and robust security. It provides a
/// comprehensive set of functionalities that enable developers to build sophisticated omnichain
/// applications (OApps) with ease.
///
/// ## Key Features
/// - **Message Sending and Receiving**: Core functions for sending and receiving messages across
/// different blockchains,
///   abstracting away the complexities of cross-chain communication.
/// - **Configurable Security**: OApps can define their own security requirements by specifying a
/// set of Data Verification
///   Networks (DVNs) and a threshold of required verifications, ensuring that each message meets
///   the application's security standards.
/// - **Fee Quotation**: Provides a mechanism to quote the cost of sending a message, allowing
/// applications to estimate
///   and manage transaction fees transparently.
/// - **Message Verification and Execution**: Verifies the authenticity of incoming messages through
/// the configured DVNs
///   and ensures that only valid messages are executed.
/// - **Verify-Store-Execute Pattern**: Implements a secure message handling pattern where message
/// payload hashes are stored
///   on-chain and executed only after successful verification, preventing race conditions and other
///   security vulnerabilities.
/// - **Alerts and Error Handling**: Includes a system for receiving alerts about failed messages,
/// enabling robust error
///   handling and recovery mechanisms.
/// - **Delegate and Token Management**: Supports delegation of OApp configuration management and
/// allows for the use of
///   a specific token for paying LayerZero fees.
#[derive(Drop, Serde)]
pub enum ExecutionState {
    NotExecutable, // executor: waits for PayloadVerified event and starts polling for executable
    VerifiedButNotExecutable, // executor: starts active polling for executable
    Executable,
    Executed,
}

#[starknet::interface]
pub trait IEndpointV2<TContractState> {
    /// Sends a message to a remote OApp.
    ///
    /// # Arguments
    ///
    /// * `params` - A `MessagingParams` struct containing the destination EID, receiver address,
    /// message payload,
    ///   OApp-specific options, and whether to pay in the LZ token.
    /// * `refund_address` - The address to which any remaining gas fees should be refunded.
    ///
    /// # Returns
    ///
    /// * `MessageReceipt` - A struct containing the GUID of the message and the nonce.
    ///
    /// @dev This function is the primary entry point for sending a message from a local OApp to a
    /// remote OApp.
    /// It encodes the message, calculates the required fee, and dispatches it to the LayerZero
    /// network.
    fn send(
        ref self: TContractState, params: MessagingParams, refund_address: ContractAddress,
    ) -> MessageReceipt;

    /// Quotes the fee for sending a message.
    ///
    /// # Arguments
    ///
    /// * `params` - A `MessagingParams` struct containing the destination EID, receiver address,
    /// message payload,
    ///   OApp-specific options, and whether to pay in the LZ token.
    /// * `sender` - The address of the OApp sending the message.
    ///
    /// # Returns
    ///
    /// * `MessagingFee` - A struct containing the native fee and the LZ token fee required to send
    /// the message.
    ///
    /// @dev This function allows an OApp to estimate the cost of sending a message before actually
    /// sending it.
    /// The fee is calculated based on the message parameters and the current network conditions.
    fn quote(
        self: @TContractState, params: MessagingParams, sender: ContractAddress,
    ) -> MessagingFee;

    /// Verifies a message and stores the payload hash.
    ///
    /// # Arguments
    ///
    /// * `origin` - An `Origin` struct containing the source EID and sender address.
    /// * `receiver` - The address of the OApp that will receive the message.
    /// * `payload_hash` - The Keccak-256 hash of the message payload.
    ///
    /// @dev This function is called by the LayerZero network to verify a message and store the
    /// payload hash EndpointV2.
    /// It stores a hash of the message payload, which will be used later for verification.
    /// This is part of the verify-store-execute pattern to ensure secure message handling.
    fn verify(
        ref self: TContractState, origin: Origin, receiver: ContractAddress, payload_hash: Bytes32,
    );

    /// Receives and executes a message from a remote OApp.
    ///
    /// # Arguments
    ///
    /// * `origin` - An `Origin` struct containing the source EID and sender address.
    /// * `receiver` - The address of the OApp that will receive the message.
    /// * `guid` - The globally unique identifier of the message.
    /// * `message` - The message payload.
    /// * `extra_data` - Additional data provided by the executor.
    /// * `value` - The value sent with the message.
    ///
    /// @dev This function is called by the LayerZero network after a message has been successfully
    /// verified.
    /// It decodes the message and calls the `lz_receive` function on the destination OApp.
    fn lz_receive(
        ref self: TContractState,
        origin: Origin,
        receiver: ContractAddress,
        guid: Bytes32,
        message: ByteArray,
        extra_data: ByteArray,
        value: u256,
    );

    /// Receives an alert about a failed message.
    ///
    /// # Arguments
    ///
    /// * `origin` - An `Origin` struct containing the source EID and sender address.
    /// * `receiver` - The address of the OApp that was supposed to receive the message.
    /// * `guid` - The GUID of the failed message.
    /// * `gas` - The amount of gas used before the failure.
    /// * `value` - The value sent with the message.
    /// * `message` - The message payload.
    /// * `extra_data` - Additional data provided by the executor.
    /// * `reason` - An array of felts describing the reason for the failure.
    ///
    /// @dev This function is called by the LayerZero network when a message fails to be delivered
    /// or executed.
    /// It allows the OApp to handle the failure gracefully, for example, by retrying the message or
    /// notifying a user.
    fn lz_receive_alert(
        ref self: TContractState,
        origin: Origin,
        receiver: ContractAddress,
        guid: Bytes32,
        gas: u256,
        value: u256,
        message: ByteArray,
        extra_data: ByteArray,
        reason: Array<felt252>,
    );

    /// Clears a stored message payload from the contract's storage.
    ///
    /// # Arguments
    ///
    /// * `origin` - An `Origin` struct containing the source EID and sender address.
    /// * `receiver` - The address of the OApp that received the message.
    /// * `guid` - The GUID of the message.
    /// * `message` - The message payload.
    ///
    /// @dev This function is called by the LayerZero network after a message has been successfully
    /// executed to remove the stored payload hash and free up storage space.
    fn clear(
        ref self: TContractState,
        origin: Origin,
        receiver: ContractAddress,
        guid: Bytes32,
        message: ByteArray,
    );

    /// Gets the address of the LZ token used for paying fees.
    ///
    /// # Returns
    ///
    /// * `lz_token_address` - The address of the LZ token contract.
    ///
    /// @dev The LZ token is an alternative to the native token for paying LayerZero fees.
    /// This function returns the address of the LZ token contract.
    fn get_lz_token(self: @TContractState) -> ContractAddress;

    /// Gets the endpoint ID (EID) of the local chain.
    ///
    /// # Returns
    ///
    /// * `eid` - The EID of the local chain.
    ///
    /// @dev The EID is a unique identifier for each chain supported by LayerZero.
    /// This function returns the EID of the chain where the EndpointV2 contract is deployed.
    fn get_eid(self: @TContractState) -> u32;

    /// Sets the address of the LZ token used for paying fees.
    ///
    /// # Arguments
    ///
    /// * `lz_token_address` - The new address of the LZ token contract.
    ///
    /// # Panics
    /// * If the LZ token address is the same as the native token address.
    fn set_lz_token(ref self: TContractState, lz_token_address: ContractAddress);

    /// Sets the delegate for an OApp.
    ///
    /// # Arguments
    /// * `delegate` - The address to be set as the delegate.
    ///
    /// @dev The delegate is an address that is authorized to manage the OApp's configurations,
    /// such as the required DVNs and the verification threshold.
    /// This allows for separation of concerns, where the OApp owner can delegate configuration
    /// management to a separate address.
    fn set_delegate(ref self: TContractState, delegate: ContractAddress);

    /// Gets the delegate for an OApp.
    ///
    /// # Arguments
    /// * `oapp` - The address of the OApp.
    ///
    /// # Returns
    /// * `ContractAddress` - The address of the delegate.
    fn get_delegate(self: @TContractState, oapp: ContractAddress) -> ContractAddress;


    /// Checks if a message path is initializable.
    ///
    /// # Arguments
    ///
    /// * `origin` - An `Origin` struct containing the source EID and sender address.
    /// * `receiver` - The address of the OApp that will receive the message.
    ///
    /// # Returns
    /// * `bool` - `true` if the message path is initializable, `false` otherwise.
    ///
    /// @dev A message path is initializable if it has not been configured yet.
    /// This function is used to determine if a new configuration can be set for a given message
    /// path.
    fn initializable(self: @TContractState, origin: Origin, receiver: ContractAddress) -> bool;

    /// Check if the message is verifiable
    ///
    /// # Arguments
    ///
    /// * `origin`: The origin of the message
    /// * `receiver`: The receiver of the message
    ///
    /// # Returns
    /// * `bool` - True if the message is verifiable, false otherwise
    fn verifiable(self: @TContractState, origin: Origin, receiver: ContractAddress) -> bool;

    /// Check if the message is verifiable with a receive library
    ///
    /// # Arguments
    ///
    /// * `origin`: The origin of the message
    /// * `receiver`: The receiver of the message
    /// * `receive_lib`: The receive library of the message
    ///
    /// # Returns
    /// * `bool` - True if the message is verifiable with a receive library, false otherwise
    fn verifiable_with_receive_lib(
        self: @TContractState,
        origin: Origin,
        receiver: ContractAddress,
        receive_lib: ContractAddress,
    ) -> bool;

    /// Check if the message is executable
    ///
    /// # Arguments
    ///
    /// * `origin` - An `Origin` struct containing the source EID and sender address.
    /// * `receiver` - The address of the OApp that will receive the message.
    ///
    /// # Returns
    /// * `ExecutionState` - The execution state of the message
    fn executable(
        self: @TContractState, origin: Origin, receiver: ContractAddress,
    ) -> ExecutionState;
}
