//! Fuzzable key pair

use snforge_std::fuzzable::Fuzzable;
use crate::workers::dvn::utils::{KeyPair, key_pair_from_private_key};

/// Generate a random key pair
pub(crate) impl FuzzableKeyPair of Fuzzable<KeyPair> {
    fn generate() -> KeyPair {
        let private_key: u256 = Fuzzable::generate();
        key_pair_from_private_key(private_key)
    }

    fn blank() -> KeyPair {
        key_pair_from_private_key(0)
    }
}
