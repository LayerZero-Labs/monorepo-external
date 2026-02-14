//! Fuzzable Bytes32

use lz_utils::bytes::Bytes32;
use snforge_std::fuzzable::{Fuzzable, FuzzableU256};

/// Generate a random Bytes32
pub(crate) impl FuzzableBytes32 of Fuzzable<Bytes32> {
    fn generate() -> Bytes32 {
        let value: u256 = FuzzableU256::generate();
        value.into()
    }

    fn blank() -> Bytes32 {
        Default::default()
    }
}
