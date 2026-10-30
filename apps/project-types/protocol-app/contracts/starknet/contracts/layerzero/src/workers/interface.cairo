//! ILayerZeroWorker interface used by the DVN and Executor workers

use crate::workers::base::structs::QuoteParams;

#[starknet::interface]
pub trait ILayerZeroWorker<TContractState> {
    // ================================== Only Message Lib =====================================

    /// Assign a job
    ///
    /// # Arguments
    /// * `params` - Parameters for assigning a job
    ///
    /// # Returns
    /// * `u256` - The fee for the job
    ///
    /// @dev This function is only callable by message libs.
    fn assign_job(ref self: TContractState, params: QuoteParams) -> u256;

    // ================================== View =====================================

    /// Quote the fee for a job
    ///
    /// # Arguments
    /// * `params` - Parameters for quoting the fee
    ///
    /// # Returns
    /// * `u256` - The fee for the job
    ///
    /// @dev This function is callable by anyone.
    fn quote(self: @TContractState, params: QuoteParams) -> u256;
}
