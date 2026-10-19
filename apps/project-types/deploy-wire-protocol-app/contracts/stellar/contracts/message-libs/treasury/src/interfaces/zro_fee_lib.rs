use soroban_sdk::{contractclient, Address, Env};

/// Interface for ZRO token fee library.
///
/// The ZRO token fee library calculates treasury fees when paying in ZRO tokens.
/// This allows for custom fee calculation logic when users opt to pay fees in ZRO.
#[contractclient(name = "ZroFeeLibClient")]
pub trait IZroFeeLib {
    /// Get the treasury fee in ZRO tokens based on the total native fee.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `total_native_fee` - The total native fee charged to the sender
    /// * `native_treasury_fee` - The treasury fee in native tokens
    ///
    /// # Returns
    /// The amount of ZRO tokens to be paid
    fn get_fee(env: &Env, sender: &Address, dst_eid: u32, total_native_fee: i128, native_treasury_fee: i128) -> i128;
}
