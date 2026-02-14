use crate::oapps::common::fee::structs::FeeConfig;

#[starknet::interface]
pub trait IFee<TContractState> {
    // ================================== Only Owner ===============================

    /// Sets the default fee basis points for all destinations
    ///
    /// # Arguments
    /// * `fee_bps` - The fee basis points
    fn set_default_fee_bps(ref self: TContractState, fee_bps: u16);

    /// Sets the fee basis points for a specific destination endpoint
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    /// * `fee_bps` - The fee basis points
    /// * `enabled` - Whether the fee is enabled
    fn set_fee_bps(ref self: TContractState, dst_eid: u32, fee_bps: u16, enabled: bool);

    // ================================== View ===============================

    /// Gets the fee for a given destination endpoint
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    /// * `amount` - The amount to calculate the fee for
    ///
    /// # Returns
    /// * `u256` - The fee amount
    fn get_fee(self: @TContractState, dst_eid: u32, amount: u256) -> u256;

    /// Gets the fee basis points for a given destination endpoint
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// * `FeeConfig` - The fee basis points
    fn get_raw_fee_bps(self: @TContractState, dst_eid: u32) -> FeeConfig;

    /// Gets the default fee basis points
    ///
    /// # Returns
    /// * `u16` - The default fee basis points
    fn get_raw_default_fee_bps(self: @TContractState) -> u16;

    /// Gets the BPS denominator
    ///
    /// # Returns
    /// * `u16` - The BPS denominator
    fn get_raw_bps_denominator(self: @TContractState) -> u16;
}
