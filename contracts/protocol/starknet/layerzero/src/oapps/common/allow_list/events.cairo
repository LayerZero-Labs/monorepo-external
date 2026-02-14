//! AllowList events

use starknet::ContractAddress;
use crate::oapps::common::allow_list::interface::AllowlistMode;

/// Emitted when the allowlist mode is updated
#[derive(Drop, starknet::Event)]
pub struct AllowlistModeUpdated {
    #[key]
    pub mode: AllowlistMode,
}

/// Emitted when a user's whitelist status is updated
#[derive(Drop, starknet::Event)]
pub struct WhitelistUpdated {
    #[key]
    pub user: ContractAddress,
    pub status: bool,
}

/// Emitted when a user's blacklist status is updated
#[derive(Drop, starknet::Event)]
pub struct BlacklistUpdated {
    #[key]
    pub user: ContractAddress,
    pub status: bool,
}
