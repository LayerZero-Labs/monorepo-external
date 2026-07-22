use layerzero::oapps::common::allow_list::interface::AllowlistMode;
use starknet::{ClassHash, ContractAddress};

#[starknet::interface]
pub trait IERC20MintBurnUpgradeable<TContractState> {
    /// Upgrades the contract
    ///
    /// # Arguments
    /// * `new_class_hash` - The new class hash to upgrade to
    ///
    /// # Events
    /// * `Upgraded` - Emitted when the contract is upgraded (from OpenZeppelin's
    /// [`UpgradeableComponent`])
    ///
    /// @dev This function is only callable by the default admin.
    fn upgrade(ref self: TContractState, new_class_hash: ClassHash);

    /// Upgrades the contract and calls a function
    ///
    /// # Arguments
    /// * `new_class_hash` - The new class hash to upgrade to
    /// * `selector` - The selector to call
    /// * `data` - The data to pass to the function
    ///
    /// # Returns
    /// * `Span<felt252>` - The response data from the function call
    ///
    /// # Events
    /// * `Upgraded` - Emitted when the contract is upgraded (from OpenZeppelin's
    /// [`UpgradeableComponent`])
    ///
    /// @dev This function is only callable by the default admin.
    fn upgrade_and_call(
        ref self: TContractState,
        new_class_hash: ClassHash,
        selector: felt252,
        calldata: Span<felt252>,
    ) -> Span<felt252>;

    // =============================== Pause ===============================

    /// Pauses the contract
    ///
    /// # Events
    /// * `Paused` - Emitted when the contract is paused (from OpenZeppelin's
    /// [`PausableComponent`])
    fn pause(ref self: TContractState);

    /// Unpauses the contract
    ///
    /// # Events
    /// * `Unpaused` - Emitted when the contract is unpaused (from OpenZeppelin's
    /// [`PausableComponent`])
    fn unpause(ref self: TContractState);

    // =============================== Allowlist ===============================

    /// Sets the allowlist mode
    ///
    /// # Arguments
    /// * `mode` - The new allowlist mode (Open, Blacklist, or Whitelist)
    ///
    /// # Access Control
    /// Only callable by accounts with ALLOWLIST_MANAGER_ROLE
    fn set_allowlist_mode(ref self: TContractState, mode: AllowlistMode);

    /// Sets the whitelist status for multiple users
    ///
    /// # Arguments
    /// * `users` - Array of user addresses
    /// * `status` - Whether to whitelist (true) or unwhitelist (false)
    ///
    /// # Access Control
    /// Only callable by accounts with ALLOWLIST_MANAGER_ROLE
    fn set_whitelisted(ref self: TContractState, users: Span<ContractAddress>, status: bool);

    /// Sets the blacklist status for multiple users
    ///
    /// # Arguments
    /// * `users` - Array of user addresses
    /// * `status` - Whether to blacklist (true) or unblacklist (false)
    ///
    /// # Access Control
    /// Only callable by accounts with ALLOWLIST_MANAGER_ROLE
    fn set_blacklisted(ref self: TContractState, users: Span<ContractAddress>, status: bool);
}
