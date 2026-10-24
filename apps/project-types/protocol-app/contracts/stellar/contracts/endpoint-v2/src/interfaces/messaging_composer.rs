use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env};

/// EndpointV2's Interface for managing composed messages between OApps and composers.
#[contractclient(name = "MessagingComposerClient")]
pub trait IMessagingComposer {
    /// Sends a composed message from an OApp to a composer.
    /// The OApp can send compose to multiple composers with the same GUID.
    ///
    /// # Arguments
    /// * `from` - The sender OApp address, must provide authorization
    /// * `to` - The composer address that will receive the message
    /// * `guid` - The message GUID
    /// * `index` - The compose message index
    /// * `message` - The composed message content
    fn send_compose(env: &Env, from: &Address, to: &Address, guid: &BytesN<32>, index: u32, message: &Bytes);

    /// Clears a composed message after execution by the composer.
    /// This is PULL mode - the composer calls this after processing the message.
    ///
    /// # Arguments
    /// * `composer` - The composer address, must provide authorization
    /// * `from` - The sender OApp address
    /// * `guid` - The message GUID
    /// * `index` - The compose message index
    /// * `message` - The composed message content (must match stored hash)
    fn clear_compose(env: &Env, composer: &Address, from: &Address, guid: &BytesN<32>, index: u32, message: &Bytes);

    /// Emits an alert event when `lz_compose` execution fails.
    ///
    /// # Arguments
    /// * `executor` - The executor address, must provide authorization
    /// * `from` - The sender OApp address
    /// * `to` - The composer address
    /// * `guid` - The message GUID
    /// * `index` - The compose message index
    /// * `gas` - The fee provided for execution (named "gas" for cross-chain interface consistency, though Stellar uses fees not gas)
    /// * `value` - The value provided for execution
    /// * `message` - The composed message content
    /// * `extra_data` - Additional data for execution
    /// * `reason` - The failure reason
    fn lz_compose_alert(
        env: &Env,
        executor: &Address,
        from: &Address,
        to: &Address,
        guid: &BytesN<32>,
        index: u32,
        gas: i128,
        value: i128,
        message: &Bytes,
        extra_data: &Bytes,
        reason: &Bytes,
    );

    /// Returns the stored hash for a composed message.
    ///
    /// # Arguments
    /// * `from` - The sender OApp address
    /// * `to` - The composer address
    /// * `guid` - The message GUID
    /// * `index` - The compose message index
    fn compose_queue(env: &Env, from: &Address, to: &Address, guid: &BytesN<32>, index: u32) -> Option<BytesN<32>>;
}
