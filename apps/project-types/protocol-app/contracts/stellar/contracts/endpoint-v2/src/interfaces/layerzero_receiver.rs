use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env};

use crate::Origin;

/// Interface for OApps that can receive cross-chain messages.
#[contractclient(name = "LayerZeroReceiverClient")]
pub trait ILayerZeroReceiver {
    /// Checks if a messaging path can be initialized for the given origin.
    ///
    /// # Arguments
    /// * `origin` - The origin of the message
    ///
    /// # Returns
    /// True if the path can be initialized, false otherwise
    fn allow_initialize_path(env: &Env, origin: &Origin) -> bool;

    /// Returns the next expected nonce for ordered message delivery.
    /// 0 means there is NO nonce ordered enforcement.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address
    fn next_nonce(env: &Env, src_eid: u32, sender: &BytesN<32>) -> u64;

    /// Receives and processes a cross-chain message.
    ///
    /// # Arguments
    /// * `executor` - The executor address delivering the message
    /// * `origin` - The origin information (source EID, sender, nonce)
    /// * `guid` - The message GUID
    /// * `message` - The message content
    /// * `extra_data` - Additional executor-provided data (untrusted)
    /// * `value` - The native token value sent with the message
    fn lz_receive(
        env: &Env,
        executor: &Address,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        value: i128,
    );
}
