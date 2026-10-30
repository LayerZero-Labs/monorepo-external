//! Fuzzable contract addresses

use core::num::traits::Zero;
use snforge_std::fuzzable::Fuzzable;
use starknet::ContractAddress;

/// Generate a random contract address
pub(crate) impl FuzzableContractAddress of Fuzzable<ContractAddress> {
    fn generate() -> ContractAddress {
        let mut address_felt: felt252 = Fuzzable::generate();
        address_felt.try_into().unwrap()
    }

    fn blank() -> ContractAddress {
        Zero::zero()
    }
}

/// Generate an array of random contract addresses
pub(crate) impl FuzzableContractAddresses of Fuzzable<Array<ContractAddress>> {
    fn generate() -> Array<ContractAddress> {
        const MAX_LENGTH: usize = 10;
        let length: usize = Fuzzable::generate() % MAX_LENGTH;
        let mut addresses = array![];

        for _ in 0..length {
            let address = Fuzzable::<ContractAddress>::generate();

            addresses.append(address);
        }

        addresses
    }

    fn blank() -> Array<ContractAddress> {
        array![]
    }
}

// A wrapper type around an array of ContractAddress to help fuzzer argument parsing
#[derive(Drop, Serde, Debug, PartialEq, Clone, Default)]
pub(crate) struct ContractAddressArrayList {
    pub arr: Array<ContractAddress>,
}

pub(crate) impl FuzzableContractAddressArrayList of Fuzzable<ContractAddressArrayList> {
    fn blank() -> ContractAddressArrayList {
        Default::default()
    }

    fn generate() -> ContractAddressArrayList {
        ContractAddressArrayList { arr: FuzzableContractAddresses::generate() }
    }
}
