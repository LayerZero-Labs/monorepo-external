use snforge_std::fuzzable::{Fuzzable, FuzzableU64};
use crate::endpoint::messaging_channel::utils::InboundSetupParams;

// Fuzzable for InboundSetupParams with constraints and invariant
pub impl FuzzableInboundSetupParams of Fuzzable<InboundSetupParams> {
    fn generate() -> InboundSetupParams {
        let mut executed_until = FuzzableU64::generate() % 50;
        let committed_until = FuzzableU64::generate() % 50;
        executed_until =
            if executed_until <= committed_until {
                executed_until
            } else {
                committed_until
            };
        InboundSetupParams { executed_until, committed_until }
    }

    fn blank() -> InboundSetupParams {
        InboundSetupParams { executed_until: 0, committed_until: 0 }
    }
}
