//! Test utilities for DVN multisig testing
//!
//! Provides key pair generation and signing for secp256k1 ECDSA signatures.

extern crate std;

use k256::ecdsa::{SigningKey, VerifyingKey};
use sha3::{Digest, Keccak256};
use soroban_sdk::{BytesN, Env};

/// A secp256k1 key pair with private key and derived Ethereum-style address
#[derive(Clone)]
pub struct KeyPair {
    /// The secp256k1 signing key (private key)
    signing_key: SigningKey,
    /// The derived Ethereum-style address (last 20 bytes of keccak256(pubkey))
    pub eth_address: [u8; 20],
}

impl KeyPair {
    pub fn generate() -> Self {
        let signing_key = SigningKey::random(&mut rand::thread_rng());
        let eth_address = Self::derive_eth_address(&signing_key);
        Self { signing_key, eth_address }
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

    pub fn signer(&self, env: &Env) -> BytesN<20> {
        BytesN::from_array(env, &self.eth_address)
    }

    /// Sign a 32-byte digest and return a 65-byte signature (r || s || v)
    pub fn sign(&self, digest: &[u8; 32]) -> [u8; 65] {
        let (signature, recovery_id) = self.signing_key.sign_prehash_recoverable(digest).expect("Signing failed");

        let r = signature.r().to_bytes();
        let s = signature.s().to_bytes();
        let v = 27 + recovery_id.to_byte();

        let mut result = [0u8; 65];
        result[0..32].copy_from_slice(&r);
        result[32..64].copy_from_slice(&s);
        result[64] = v;

        result
    }

    /// Sign a digest and return as BytesN<65> for use in Soroban
    pub fn sign_bytes(&self, env: &Env, digest: &BytesN<32>) -> BytesN<65> {
        let signature = self.sign(&digest.to_array());
        BytesN::from_array(env, &signature)
    }
}
