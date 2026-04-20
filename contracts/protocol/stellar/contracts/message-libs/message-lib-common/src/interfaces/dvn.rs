use endpoint_v2::FeeRecipient;
use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env};

/// Interface for Decentralized Verifier Networks (DVNs) that verify cross-chain messages.
#[contractclient(name = "LayerZeroDVNClient")]
pub trait ILayerZeroDVN {
    /// Quotes the fee for verifying a message.
    ///
    /// # Arguments
    /// * `send_lib` - The send library address
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `packet_header` - The packet header bytes
    /// * `payload_hash` - The hash of the message payload
    /// * `confirmations` - The number of block confirmations required
    /// * `options` - DVN-specific options
    ///
    /// # Returns
    /// The verification fee in native token
    fn get_fee(
        env: &Env,
        send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        packet_header: &Bytes,
        payload_hash: &BytesN<32>,
        confirmations: u64,
        options: &Bytes,
    ) -> i128;

    /// Assigns a verification job to the DVN.
    ///
    /// # Arguments
    /// * `send_lib` - The send library address
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `packet_header` - The packet header bytes
    /// * `payload_hash` - The hash of the message payload
    /// * `confirmations` - The number of block confirmations required
    /// * `options` - DVN-specific options
    ///
    /// # Returns
    /// `FeeRecipient` containing the fee recipient address and fee amount
    fn assign_job(
        env: &Env,
        send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        packet_header: &Bytes,
        payload_hash: &BytesN<32>,
        confirmations: u64,
        options: &Bytes,
    ) -> FeeRecipient;
}
