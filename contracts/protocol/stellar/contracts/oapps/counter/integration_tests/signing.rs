//! Key generation utilities for DVN initialization in integration tests.
//!
//! Generates secp256k1 addresses (for DVN multisig) and Ed25519 addresses (for admin).

use ed25519_dalek::SigningKey as Ed25519SigningKey;
use k256::ecdsa::{SigningKey, VerifyingKey};
use rand::thread_rng;
use sha3::{Digest, Keccak256};
use soroban_sdk::{address_payload::AddressPayload, Address, BytesN, Env};

/// Generates an Ethereum-style address from a secp256k1 key (for DVN multisig signer).
#[derive(Clone)]
pub struct Secp256k1KeyPair {
    /// The derived Ethereum-style address (last 20 bytes of keccak256(pubkey))
    pub eth_address: [u8; 20],
}

impl Secp256k1KeyPair {
    /// Generate a new random secp256k1 address.
    pub fn generate() -> Self {
        let signing_key = SigningKey::random(&mut thread_rng());
        let eth_address = Self::derive_eth_address(&signing_key);
        Self { eth_address }
    }

    fn derive_eth_address(signing_key: &SigningKey) -> [u8; 20] {
        let verifying_key: &VerifyingKey = signing_key.verifying_key();
        let pubkey_bytes = verifying_key.to_encoded_point(false);
        let pubkey_uncompressed = pubkey_bytes.as_bytes();

        let mut hasher = Keccak256::new();
        hasher.update(&pubkey_uncompressed[1..65]);
        let hash = hasher.finalize();

        let mut eth_address = [0u8; 20];
        eth_address.copy_from_slice(&hash[12..32]);
        eth_address
    }

    /// Get the signer address as BytesN<20> for use in Soroban.
    pub fn signer(&self, env: &Env) -> BytesN<20> {
        BytesN::from_array(env, &self.eth_address)
    }
}

/// Generates an Ed25519 address (for DVN admin).
pub struct Ed25519KeyPair {
    signing_key: Ed25519SigningKey,
}

impl Ed25519KeyPair {
    /// Generate a new random Ed25519 key pair.
    pub fn generate() -> Self {
        Self { signing_key: Ed25519SigningKey::generate(&mut thread_rng()) }
    }

    /// Get the public key as a Soroban Address.
    pub fn address(&self, env: &Env) -> Address {
        let bytes_n = BytesN::from_array(env, &self.signing_key.verifying_key().to_bytes());
        Address::from_payload(env, AddressPayload::AccountIdPublicKeyEd25519(bytes_n))
    }
}
