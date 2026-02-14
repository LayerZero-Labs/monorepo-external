//! Message inspector interface

/// IMessageInspector defines the complete interface for message inspection.
#[starknet::interface]
pub trait IMessageInspector<TContractState> {
    /// Inspect the message and options
    ///
    /// This function is called to inspect the message and options before they are sent.
    /// If the message or options fail inspection, the transaction will revert.
    ///
    /// # Arguments
    /// * `message` - The message to inspect
    /// * `options` - The options to inspect
    ///
    /// # Returns
    /// * `bool` - True if the message and options pass inspection, false otherwise
    ///
    /// # Panics
    /// * If the message or options fail inspection, the transaction will revert
    fn inspect_msg(self: @TContractState, message: ByteArray, options: ByteArray) -> bool;
}
