//! Fuzzable role admin contract addresses

use snforge_std::fuzzable::Fuzzable;
use starknet::ContractAddress;
use crate::fuzzable::contract_address::FuzzableContractAddress;

/// Non-zero contract address to be used as a role admin
#[derive(Drop, Debug)]
pub(crate) struct RoleAdmin {
    pub address: ContractAddress,
}

/// Generate a random role admin address - not the _zero_ address
pub(crate) impl FuzzableRoleAdmin of Fuzzable<RoleAdmin> {
    fn generate() -> RoleAdmin {
        RoleAdmin { address: FuzzableContractAddress::generate() }
    }

    fn blank() -> RoleAdmin {
        RoleAdmin { address: 1.try_into().unwrap() }
    }
}
