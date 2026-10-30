//! Fuzzable origin

use layerzero::Origin;
use snforge_std::fuzzable::{Fuzzable, FuzzableU32, FuzzableU64};
use crate::fuzzable::bytes32::FuzzableBytes32;
use crate::fuzzable::eid::FuzzableEid;

/// Generate a random Origin
pub(crate) impl FuzzableOrigin of Fuzzable<Origin> {
    fn generate() -> Origin {
        Origin {
            src_eid: FuzzableEid::generate().eid,
            sender: FuzzableBytes32::generate(),
            nonce: FuzzableU64::generate(),
        }
    }

    fn blank() -> Origin {
        Origin { src_eid: 0, sender: Default::default(), nonce: 0 }
    }
}
