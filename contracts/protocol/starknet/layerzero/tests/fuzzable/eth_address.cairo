//! Fuzzable ETH addresses

use core::num::traits::Zero;
use snforge_std::fuzzable::Fuzzable;
use starknet::EthAddress;

/// Generate a random ETH address
pub(crate) impl FuzzableEthAddress of Fuzzable<EthAddress> {
    fn generate() -> EthAddress {
        let address_u256: u256 = Fuzzable::generate();
        Into::<_, EthAddress>::into(address_u256)
    }

    fn blank() -> EthAddress {
        Zero::zero()
    }
}
