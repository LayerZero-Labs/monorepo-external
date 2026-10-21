pub mod events;
pub mod oft_info;
pub mod types;

// Re-export procedural macros
pub use oft_macros::*;

pub const OFT_SEED: &[u8] = b"OFT";
