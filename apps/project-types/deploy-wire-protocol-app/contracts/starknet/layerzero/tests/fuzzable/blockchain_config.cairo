//! Fuzzable blockchain config

use layerzero::common::constants::ZERO_ADDRESS;
use snforge_std::fuzzable::Fuzzable;
use starknet::ContractAddress;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::keys::FuzzableKeyPair;
use crate::workers::dvn::utils::KeyPair;

#[derive(Debug, Drop)]
pub struct BlockchainConfig {
    pub native_token_supply: u256,
    pub native_token_owner: ContractAddress,
    pub lz_token_supply: u256,
    pub lz_token_owner: ContractAddress,
    pub endpoint_owner: ContractAddress,
    pub eid: Eid,
    pub message_lib_owner: ContractAddress,
    pub treasury_owner: ContractAddress,
    pub oapp_owner: ContractAddress,
    pub oft_name: ByteArray,
    pub oft_symbol: ByteArray,
    pub price_feed_owner: ContractAddress,
    pub executor_role_admin: ContractAddress,
    pub executor_admin: ContractAddress,
    pub dvn_vid: u32,
    pub dvn_signers: Array<KeyPair>,
    pub dvn_role_admin: ContractAddress,
    pub dvn_admin: ContractAddress,
    pub dvn_owner: ContractAddress,
    pub user: ContractAddress,
}

/// Generate a random blockchain config
pub(crate) impl FuzzableBlockchainConfig of Fuzzable<BlockchainConfig> {
    fn generate() -> BlockchainConfig {
        BlockchainConfig {
            native_token_supply: Fuzzable::generate(),
            native_token_owner: Fuzzable::generate(),
            lz_token_supply: Fuzzable::generate(),
            lz_token_owner: Fuzzable::generate(),
            endpoint_owner: Fuzzable::generate(),
            eid: Fuzzable::generate(),
            message_lib_owner: Fuzzable::generate(),
            treasury_owner: Fuzzable::generate(),
            oapp_owner: Fuzzable::generate(),
            oft_name: Fuzzable::generate(),
            oft_symbol: Fuzzable::generate(),
            price_feed_owner: Fuzzable::generate(),
            executor_role_admin: Fuzzable::generate(),
            executor_admin: Fuzzable::generate(),
            dvn_vid: Fuzzable::generate(),
            dvn_signers: array![Fuzzable::generate(), Fuzzable::generate()],
            dvn_role_admin: Fuzzable::generate(),
            dvn_admin: Fuzzable::generate(),
            dvn_owner: Fuzzable::generate(),
            user: Fuzzable::generate(),
        }
    }

    fn blank() -> BlockchainConfig {
        BlockchainConfig {
            native_token_supply: Default::default(),
            native_token_owner: ZERO_ADDRESS,
            lz_token_supply: Default::default(),
            lz_token_owner: ZERO_ADDRESS,
            endpoint_owner: ZERO_ADDRESS,
            eid: Default::default(),
            message_lib_owner: ZERO_ADDRESS,
            treasury_owner: ZERO_ADDRESS,
            oapp_owner: ZERO_ADDRESS,
            oft_name: Default::default(),
            oft_symbol: Default::default(),
            price_feed_owner: ZERO_ADDRESS,
            executor_role_admin: ZERO_ADDRESS,
            executor_admin: ZERO_ADDRESS,
            dvn_vid: Default::default(),
            dvn_signers: Default::default(),
            dvn_role_admin: ZERO_ADDRESS,
            dvn_admin: ZERO_ADDRESS,
            dvn_owner: ZERO_ADDRESS,
            user: ZERO_ADDRESS,
        }
    }
}
