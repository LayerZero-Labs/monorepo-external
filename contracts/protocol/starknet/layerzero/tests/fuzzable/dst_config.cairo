//! Fuzzable destination configs

use layerzero::workers::dvn::structs::DstConfig as DvnDstConfig;
use layerzero::workers::executor::structs::DstConfig as ExecutorDstConfig;
use snforge_std::fuzzable::Fuzzable;

/// Generate a random DVN destination config
pub(crate) impl FuzzableDvnDstConfig of Fuzzable<DvnDstConfig> {
    fn generate() -> DvnDstConfig {
        DvnDstConfig {
            gas: Fuzzable::generate(),
            multiplier_bps: Fuzzable::generate(),
            floor_margin_usd: Fuzzable::generate(),
        }
    }

    fn blank() -> DvnDstConfig {
        Default::default()
    }
}

/// Generate a random executor destination config
pub(crate) impl FuzzableExecutorDstConfig of Fuzzable<ExecutorDstConfig> {
    fn generate() -> ExecutorDstConfig {
        ExecutorDstConfig {
            lz_receive_base_gas: Fuzzable::generate(),
            multiplier_bps: Fuzzable::generate(),
            floor_margin_usd: Fuzzable::generate(),
            native_cap: Fuzzable::generate(),
            lz_compose_base_gas: Fuzzable::generate(),
        }
    }

    fn blank() -> ExecutorDstConfig {
        Default::default()
    }
}
