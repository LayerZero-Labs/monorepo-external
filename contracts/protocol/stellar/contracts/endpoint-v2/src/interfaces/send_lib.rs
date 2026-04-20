use super::{IMessageLib, MessagingFee};
use soroban_sdk::{contractclient, contracttype, Address, Bytes, BytesN, Env, Vec};

/// Outbound packet containing all information for cross-chain transmission.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboundPacket {
    /// Outbound nonce for this pathway.
    pub nonce: u64,
    /// Source endpoint ID.
    pub src_eid: u32,
    /// Sender address on source chain.
    pub sender: Address,
    /// Destination endpoint ID.
    pub dst_eid: u32,
    /// Receiver address on destination chain (32 bytes).
    pub receiver: BytesN<32>,
    /// Globally unique identifier for this message.
    pub guid: BytesN<32>,
    /// The message payload.
    pub message: Bytes,
}

/// A fee recipient with the amount to be paid.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeRecipient {
    /// The address to send the fee to.
    pub to: Address,
    /// Amount of fee to pay.
    pub amount: i128,
}

/// Result of send operation containing fees and encoded packet.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeesAndPacket {
    /// List of native token fee recipients (executor, DVNs, treasury).
    pub native_fee_recipients: Vec<FeeRecipient>,
    /// List of ZRO token fee recipients (treasury).
    pub zro_fee_recipients: Vec<FeeRecipient>,
    /// The encoded packet ready for transmission.
    pub encoded_packet: Bytes,
}

/// Interface for send libraries that handle outbound message encoding and fee calculation.
#[contractclient(name = "SendLibClient")]
pub trait ISendLib: IMessageLib {
    /// Quotes the fee for sending a packet without actually sending.
    ///
    /// # Arguments
    /// * `packet` - The outbound packet containing message metadata and content
    /// * `options` - Execution options (e.g., gas limit, airdrop amount)
    /// * `pay_in_zro` - Whether to pay fees in ZRO token
    ///
    /// # Returns
    /// `MessagingFee` containing estimated native and ZRO fees
    fn quote(env: &Env, packet: &OutboundPacket, options: &Bytes, pay_in_zro: bool) -> MessagingFee;

    /// Sends a packet through the message library.
    ///
    /// # Arguments
    /// * `packet` - The outbound packet containing message metadata and content
    /// * `options` - Execution options (e.g., gas limit, airdrop amount)
    /// * `pay_in_zro` - Whether to pay fees in ZRO token
    ///
    /// # Returns
    /// `FeesAndPacket` containing fee recipients and the encoded packet
    fn send(env: &Env, packet: &OutboundPacket, options: &Bytes, pay_in_zro: bool) -> FeesAndPacket;
}
