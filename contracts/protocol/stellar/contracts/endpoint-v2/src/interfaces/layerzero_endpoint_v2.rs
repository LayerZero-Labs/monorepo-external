use soroban_sdk::{contractclient, contracttype, Address, Bytes, BytesN, Env};

use super::{IMessageLibManager, IMessagingChannel, IMessagingComposer};

/// Parameters for sending a cross-chain message.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessagingParams {
    /// Destination endpoint ID (chain identifier).
    pub dst_eid: u32,
    /// Receiver address on the destination chain (32 bytes).
    pub receiver: BytesN<32>,
    /// The message payload to send.
    pub message: Bytes,
    /// Encoded executor and DVN options.
    pub options: Bytes,
    /// Whether to pay fees in ZRO token instead of native token.
    pub pay_in_zro: bool,
}

/// Source message information identifying where a cross-chain message came from.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Origin {
    /// Source endpoint ID (chain identifier).
    pub src_eid: u32,
    /// Sender address on the source chain (32 bytes).
    pub sender: BytesN<32>,
    /// Nonce for this pathway.
    pub nonce: u64,
}

/// Fee structure for cross-chain messaging.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessagingFee {
    /// Fee paid in native token (XLM).
    pub native_fee: i128,
    /// Fee paid in ZRO token (LayerZero token).
    pub zro_fee: i128,
}

/// Receipt returned after successfully sending a cross-chain message.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessagingReceipt {
    /// Globally unique identifier for the message.
    pub guid: BytesN<32>,
    /// The outbound nonce for this pathway.
    pub nonce: u64,
    /// The fees charged for sending the message.
    pub fee: MessagingFee,
}

/// The main LayerZero Endpoint V2 interface for cross-chain messaging.
#[contractclient(name = "LayerZeroEndpointV2Client")]
pub trait ILayerZeroEndpointV2: IMessageLibManager + IMessagingChannel + IMessagingComposer {
    /// Quotes the messaging fee for sending a cross-chain message.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `params` - The messaging parameters (destination, receiver, message, options)
    ///
    /// # Returns
    /// `MessagingFee` containing estimated native and ZRO fees
    fn quote(env: &Env, sender: &Address, params: &MessagingParams) -> MessagingFee;

    /// Sends a cross-chain message to a destination endpoint.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address, must provide authorization
    /// * `params` - The messaging parameters (destination, receiver, message, options)
    /// * `refund_address` - The address to receive any excess fee refunds
    ///
    /// # Returns
    /// `MessagingReceipt` containing the message GUID, nonce, and fees paid
    fn send(env: &Env, sender: &Address, params: &MessagingParams, refund_address: &Address) -> MessagingReceipt;

    /// Verifies an inbound cross-chain message from a receive library.
    ///
    /// # Arguments
    /// * `receive_lib` - The receive library address, must provide authorization
    /// * `origin` - The origin information (source EID, sender, nonce)
    /// * `receiver` - The OApp address receiving the message
    /// * `payload_hash` - The hash of the message payload
    fn verify(env: &Env, receive_lib: &Address, origin: &Origin, receiver: &Address, payload_hash: &BytesN<32>);

    /// Checks if a message can be verified for the given origin and receiver.
    ///
    /// # Arguments
    /// * `origin` - The origin of the message
    /// * `receiver` - The OApp address
    ///
    /// # Returns
    /// `true` if the message can be verified, `false` otherwise
    fn verifiable(env: &Env, origin: &Origin, receiver: &Address) -> bool;

    /// Checks if a messaging path is initializable for the given origin and receiver.
    ///
    /// # Arguments
    /// * `origin` - The origin of the message
    /// * `receiver` - The OApp address
    ///
    /// # Returns
    /// `true` if the path can be initialized, `false` otherwise
    fn initializable(env: &Env, origin: &Origin, receiver: &Address) -> bool;

    /// Clears a verified message from the endpoint (PULL mode) by the OApp.
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `origin` - The origin of the message
    /// * `receiver` - The OApp address receiving the message
    /// * `guid` - The GUID of the message
    /// * `message` - The message content
    fn clear(env: &Env, caller: &Address, origin: &Origin, receiver: &Address, guid: &BytesN<32>, message: &Bytes);

    /// Emits an alert event when `lz_receive` execution fails.
    ///
    /// # Arguments
    /// * `executor` - The executor address, must provide authorization
    /// * `origin` - The origin of the message
    /// * `receiver` - The OApp address
    /// * `guid` - The message GUID
    /// * `gas` - The fee provided for execution (named "gas" for cross-chain interface consistency, though Stellar uses fees not gas)
    /// * `value` - The value provided for execution
    /// * `message` - The message content
    /// * `extra_data` - Additional data for execution
    /// * `reason` - The failure reason
    fn lz_receive_alert(
        env: &Env,
        executor: &Address,
        origin: &Origin,
        receiver: &Address,
        guid: &BytesN<32>,
        gas: i128,
        value: i128,
        message: &Bytes,
        extra_data: &Bytes,
        reason: &Bytes,
    );

    /// Returns the endpoint ID.
    fn eid(env: &Env) -> u32;

    /// Returns the native token address used for fee payments.
    fn native_token(env: &Env) -> Address;

    /// Sets the ZRO token address for fee payments.
    ///
    /// # Arguments
    /// * `zro` - The ZRO token contract address
    fn set_zro(env: &Env, zro: &Address);

    /// Returns the ZRO token address if set.
    fn zro(env: &Env) -> Option<Address>;

    /// Sets or removes a delegate address for an OApp.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address, must provide authorization
    /// * `new_delegate` - The delegate address, or `None` to remove
    fn set_delegate(env: &Env, oapp: &Address, new_delegate: &Option<Address>);

    /// Returns the delegate address for an OApp if set.
    ///
    /// # Arguments
    /// * `oapp` - The OApp address
    fn delegate(env: &Env, oapp: &Address) -> Option<Address>;
}
