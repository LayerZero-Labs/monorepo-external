use soroban_sdk::{contractclient, Address, BytesN, Env, Vec};

/// EndpointV2's Interface for managing messaging channels, nonces, and payload hashes.
#[contractclient(name = "MessagingChannelClient")]
pub trait IMessagingChannel {
    /// Skips the next expected inbound nonce without verifying.
    ///
    /// Used to handle messages that should be bypassed (e.g., due to precrime alerts).
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender address on the source chain
    /// * `nonce` - The nonce to skip (must be the next expected nonce)
    fn skip(env: &Env, caller: &Address, receiver: &Address, src_eid: u32, sender: &BytesN<32>, nonce: u64);

    /// Marks a verified message as nil, preventing execution until re-verified.
    /// The message can be re-verified later by calling `verify` again.
    /// A non-verified nonce can be nilified by passing `None` for `payload_hash`.
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender address on the source chain
    /// * `nonce` - The nonce of the message to nilify
    /// * `payload_hash` - The payload hash (must match the stored hash), or `None` for a non-verified nonce
    fn nilify(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
        payload_hash: &Option<BytesN<32>>,
    );

    /// Marks a nonce as permanently unexecutable and un-verifiable.
    /// The nonce can never be re-verified or executed after burning.
    ///
    /// # Arguments
    /// * `caller` - The caller address, must be the OApp or its delegate
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address on the source chain
    /// * `nonce` - The nonce to burn
    /// * `payload_hash` - The payload hash (must match the stored hash)
    fn burn(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
        payload_hash: &BytesN<32>,
    );

    /// Generates the next GUID for an outbound packet.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `receiver` - The receiver OApp address on the destination chain
    ///
    /// # Returns
    /// The next GUID computed from nonce, source EID, sender, destination EID, and receiver
    fn next_guid(env: &Env, sender: &Address, dst_eid: u32, receiver: &BytesN<32>) -> BytesN<32>;

    /// Returns the current outbound nonce for a specific path.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `receiver` - The receiver OApp address on the destination chain
    ///
    /// # Returns
    /// The current outbound nonce (0 if no messages sent yet)
    fn outbound_nonce(env: &Env, sender: &Address, dst_eid: u32, receiver: &BytesN<32>) -> u64;

    /// Returns the current inbound nonce for a specific path.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address on the source chain
    ///
    /// # Returns
    /// The current inbound nonce (0 if no messages received yet)
    fn inbound_nonce(env: &Env, receiver: &Address, src_eid: u32, sender: &BytesN<32>) -> u64;

    /// Returns the pending inbound nonces for a specific path.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address on the source chain
    ///
    /// # Returns
    /// The pending inbound nonces
    fn pending_inbound_nonces(env: &Env, receiver: &Address, src_eid: u32, sender: &BytesN<32>) -> Vec<u64>;

    /// Returns the payload hash for a specific inbound nonce.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address on the source chain
    /// * `nonce` - The nonce to query
    ///
    /// # Returns
    /// The payload hash if verified, `None` otherwise
    fn inbound_payload_hash(
        env: &Env,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
    ) -> Option<BytesN<32>>;
}
