//! Fuzzable contract addresses for ofts tests

use core::num::traits::Zero;
use snforge_std::fuzzable::Fuzzable;
use starknet::ContractAddress;

/// Generate a random contract address
pub(crate) impl FuzzableContractAddress of Fuzzable<ContractAddress> {
    fn generate() -> ContractAddress {
        loop {
            if let Some(address) = Fuzzable::<felt252>::generate().try_into() {
                return address;
            }
        }
    }

    fn blank() -> ContractAddress {
        Zero::zero()
    }
}

