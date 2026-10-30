//! AllowList public interface

use starknet::ContractAddress;

/// Allowlist mode enum - determines how the allowlist operates
#[derive(Drop, Copy, PartialEq, Serde, starknet::Store, Debug)]
pub enum AllowlistMode {
    /// All users are allowed (default)
    #[default]
    Open,
    /// Users on the blacklist are denied, all others allowed
    Blacklist,
    /// Only users on the whitelist are allowed
    Whitelist,
}

/// AllowList public functions
#[starknet::interface]
pub trait IAllowlist<TContractState> {
    /// Returns the current allowlist mode
    fn allowlist_mode(self: @TContractState) -> AllowlistMode;

    /// Checks if a user is allowlisted under the current mode
    fn is_user_allowlisted(self: @TContractState, user: ContractAddress) -> bool;

    /// Checks if a user is blacklisted
    fn blacklisted(self: @TContractState, user: ContractAddress) -> bool;

    /// Checks if a user is whitelisted
    fn whitelisted(self: @TContractState, user: ContractAddress) -> bool;
}
