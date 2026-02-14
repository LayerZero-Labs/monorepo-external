use layerzero::oapps::common::rate_limiter::structs::{
    RateLimitConfig, RateLimitDirection, RateLimitEnabled,
};
use starknet::{ClassHash, ContractAddress};

#[starknet::interface]
pub trait IMintableToken<TContractState> {
    fn permissioned_mint(ref self: TContractState, account: ContractAddress, amount: u256);
    fn permissioned_burn(ref self: TContractState, account: ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait IOFTMintBurnAdapter<TContractState> {
    // =============================== View ===============================

    /// Gets the fee balance
    ///
    /// # Returns
    ///
    /// * `u256` - The fee balance
    fn fee_balance(self: @TContractState) -> u256;

    /// Gets the minter burner contract address
    ///
    /// # Returns
    ///
    /// * `ContractAddress` - The minter burner contract address
    fn get_minter_burner(self: @TContractState) -> ContractAddress;

    // =============================== Only Owner or Role ===============================

    /// Sets the rate limits
    ///
    /// # Arguments
    /// * `rate_limits` - The rate limits
    /// * `direction` - The rate limit direction
    fn set_rate_limits(
        ref self: TContractState,
        rate_limits: Array<RateLimitConfig>,
        direction: RateLimitDirection,
    );

    /// Sets the rate limits enabled
    ///
    /// # Arguments
    /// * `enabled` - The rate limits enabled
    fn set_rate_limits_enabled(ref self: TContractState, enabled: RateLimitEnabled);

    /// Resets the rate limits for the given endpoint IDs.
    ///
    /// This sets `amount_in_flight` to zero for both outbound and inbound directions.
    /// Useful when limit thresholds are reduced below current amount in flight, or for
    /// emergency recovery.
    ///
    /// # Arguments
    /// * `eids` - The endpoint IDs to reset rate limits for
    fn reset_rate_limits(ref self: TContractState, eids: Array<u32>);

    /// Withdraws the fees
    ///
    /// # Arguments
    /// * `to` - The address to withdraw the fees to
    fn withdraw_fees(ref self: TContractState, to: ContractAddress);

    // =============================== Upgrade ===============================

    /// Upgrades the contract
    ///
    /// # Arguments
    /// * `new_class_hash` - The new class hash to upgrade to
    fn upgrade(ref self: TContractState, new_class_hash: ClassHash);

    /// Upgrades the contract and calls a function
    ///
    /// # Arguments
    /// * `new_class_hash` - The new class hash to upgrade to
    /// * `selector` - The selector to call
    /// * `calldata` - The calldata to pass to the function
    ///
    /// # Returns
    fn upgrade_and_call(
        ref self: TContractState,
        new_class_hash: ClassHash,
        selector: felt252,
        calldata: Span<felt252>,
    ) -> Span<felt252>;

    // =============================== Pause ===============================

    /// Pauses the contract
    fn pause(ref self: TContractState);

    /// Unpauses the contract
    fn unpause(ref self: TContractState);
}
