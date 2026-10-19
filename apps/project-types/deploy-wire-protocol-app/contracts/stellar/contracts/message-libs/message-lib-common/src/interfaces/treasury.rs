use soroban_sdk::{contractclient, Address, Env};

/// Interface for the treasury that collects protocol fees.
#[contractclient(name = "LayerZeroTreasuryClient")]
pub trait ILayerZeroTreasury {
    /// Quotes the treasury fee for a message.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    /// * `total_native_fee` - The total native fee for the message
    /// * `pay_in_zro` - Whether to pay fees in ZRO token
    ///
    /// # Returns
    /// The treasury fee amount
    fn get_fee(env: &Env, sender: &Address, dst_eid: u32, total_native_fee: i128, pay_in_zro: bool) -> i128;
}
