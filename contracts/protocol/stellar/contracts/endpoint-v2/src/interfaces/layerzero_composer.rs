use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env};

/// Interface for contracts that can receive composed messages.
#[contractclient(name = "LayerZeroComposerClient")]
pub trait ILayerZeroComposer {
    /// Receives and processes a composed message from an OApp.
    ///
    /// # Arguments
    /// * `executor` - The executor address delivering the message
    /// * `from` - The OApp address that sent the composed message
    /// * `guid` - The message GUID
    /// * `index` - The compose message index
    /// * `message` - The composed message content
    /// * `extra_data` - Additional executor-provided data
    /// * `value` - The native token value sent with the message
    fn lz_compose(
        env: &Env,
        executor: &Address,
        from: &Address,
        guid: &BytesN<32>,
        index: u32,
        message: &Bytes,
        extra_data: &Bytes,
        value: i128,
    );
}
