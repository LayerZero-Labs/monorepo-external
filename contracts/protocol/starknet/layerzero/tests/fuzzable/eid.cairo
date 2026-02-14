//! Fuzzable endpoint IDs

use core::num::traits::SaturatingSub;
use layerzero::common::constants::MAX_V1_EID;
use snforge_std::fuzzable::{Fuzzable, FuzzableU32};

/// EndpointV2 ID - `u32` in the range of `[0, MAX_V1_EID)`
#[derive(Default, Drop, PartialEq, Debug)]
pub(crate) struct Eid {
    pub eid: u32,
}

/// Generate a random EID
pub(crate) impl FuzzableEid of Fuzzable<Eid> {
    fn generate() -> Eid {
        let eid = FuzzableU32::generate().saturating_sub(MAX_V1_EID) + MAX_V1_EID;
        Eid { eid }
    }

    fn blank() -> Eid {
        Default::default()
    }
}
