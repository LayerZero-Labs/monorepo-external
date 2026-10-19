//! Test setup utilities for DVN tests

extern crate std;

use crate::{dvn::LzDVN, tests::key_pair::KeyPair};
use soroban_sdk::{address_payload::AddressPayload, testutils::Address as _, vec, Address, BytesN, Env, Vec};
use std::vec::Vec as StdVec;

pub const VID: u32 = 1;
pub const DEFAULT_MULTIPLIER_BPS: u32 = 10000;

pub struct TestSetup {
    pub env: Env,
    pub contract_id: Address,
    pub key_pairs: StdVec<KeyPair>,
    pub admins: Vec<Address>,
}

impl TestSetup {
    /// Create a new test setup with the specified number of signers
    /// Threshold defaults to signer_count
    pub fn new(signer_count: u32) -> Self {
        Self::with_threshold(signer_count, signer_count)
    }

    /// Create a new test setup with custom threshold
    pub fn with_threshold(signer_count: u32, threshold: u32) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let key_pairs: StdVec<KeyPair> = (0..signer_count).map(|_| KeyPair::generate()).collect();

        let mut signers: Vec<BytesN<20>> = vec![&env];
        key_pairs.iter().for_each(|kp| signers.push_back(kp.signer(&env)));

        let admins: Vec<Address> = vec![&env, Address::generate(&env)];
        let supported_msglibs: Vec<Address> = vec![&env, Address::generate(&env)];
        let price_feed: Address = Address::generate(&env);
        let worker_fee_lib: Address = Address::generate(&env);
        let deposit_address: Address = Address::generate(&env);

        let contract_id = env.register(
            LzDVN,
            (
                &VID,
                &signers,
                &threshold,
                &admins,
                &supported_msglibs,
                &price_feed,
                &DEFAULT_MULTIPLIER_BPS,
                &worker_fee_lib,
                &deposit_address,
            ),
        );

        Self { env, contract_id, key_pairs, admins }
    }

    /// Create a new test setup with additional admins (as Ed25519 public key bytes)
    pub fn with_admin_bytes(signer_count: u32, admin_bytes: StdVec<[u8; 32]>) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let key_pairs: StdVec<KeyPair> = (0..signer_count).map(|_| KeyPair::generate()).collect();

        let mut signers: Vec<BytesN<20>> = vec![&env];
        key_pairs.iter().for_each(|kp| signers.push_back(kp.signer(&env)));

        let mut admins: Vec<Address> = vec![&env, Address::generate(&env)];
        admin_bytes.into_iter().for_each(|bytes| {
            let bytes_n = BytesN::from_array(&env, &bytes);
            let addr = Address::from_payload(&env, AddressPayload::AccountIdPublicKeyEd25519(bytes_n));
            admins.push_back(addr);
        });

        let supported_msglibs: Vec<Address> = vec![&env, Address::generate(&env)];
        let price_feed: Address = Address::generate(&env);
        let worker_fee_lib: Address = Address::generate(&env);
        let deposit_address: Address = Address::generate(&env);

        let contract_id = env.register(
            LzDVN,
            (
                &VID,
                &signers,
                &signer_count,
                &admins,
                &supported_msglibs,
                &price_feed,
                &DEFAULT_MULTIPLIER_BPS,
                &worker_fee_lib,
                &deposit_address,
            ),
        );

        Self { env, contract_id, key_pairs, admins }
    }
}
