pub mod fee_config_view;
pub mod set_default_fee_bps;
pub mod set_fee_bps;

pub use fee_config_view::*;
pub use set_default_fee_bps::*;
pub use set_fee_bps::*;

/// Basis-points denominator for fee calculations (1 bps = 1/10_000).
pub const MAX_FEE_BASIS_POINTS: u16 = 10_000;
