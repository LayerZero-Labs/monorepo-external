use endpoint_v2::FeeRecipient;
use soroban_sdk::{contractclient, Address, Bytes, Env};

/// Interface for executors that handle message delivery on the destination chain.
#[contractclient(name = "LayerZeroExecutorClient")]
pub trait ILayerZeroExecutor {
    /// Quotes the fee for executing a message on the destination chain.
    ///
    /// # Arguments
    /// * `send_lib` - The send library address
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `calldata_size` - The size of the calldata to execute
    /// * `options` - Execution options (gas limit, airdrop, etc.)
    ///
    /// # Returns
    /// The execution fee in native token
    fn get_fee(
        env: &Env,
        send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        calldata_size: u32,
        options: &Bytes,
    ) -> i128;

    /// Assigns an execution job to the executor.
    ///
    /// # Arguments
    /// * `send_lib` - The send library address
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `calldata_size` - The size of the calldata to execute
    /// * `options` - Execution options (gas limit, airdrop, etc.)
    ///
    /// # Returns
    /// `FeeRecipient` containing the fee recipient address and fee amount
    fn assign_job(
        env: &Env,
        send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        calldata_size: u32,
        options: &Bytes,
    ) -> FeeRecipient;
}
