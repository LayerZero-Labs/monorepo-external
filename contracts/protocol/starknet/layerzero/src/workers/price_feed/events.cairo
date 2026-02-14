//! Price feed events

use starknet::ContractAddress;

/// Event emitted when fees are withdrawn
#[derive(Drop, starknet::Event)]
pub struct FeeWithdrawn {
    #[key]
    pub token_address: ContractAddress,
    #[key]
    pub to: ContractAddress,
    pub amount: u256,
}
