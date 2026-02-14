//! Fuzzable expiry

use core::num::traits::Bounded;
use snforge_std::fuzzable::Fuzzable;

/// Expiry - between `1` (inclusive) and `u64::MAX` (exclusive)
#[derive(Drop, Clone, Default, PartialEq, Debug)]
pub struct Expiry {
    pub expiry: u64,
}

/// Generate a random expiry
pub(crate) impl FuzzableExpiry of Fuzzable<Expiry> {
    fn generate() -> Expiry {
        let mut expiry = Fuzzable::generate();

        while expiry == 0 || expiry == Bounded::MAX {
            expiry = Fuzzable::generate();
        }

        Expiry { expiry }
    }

    fn blank() -> Expiry {
        Default::default()
    }
}
