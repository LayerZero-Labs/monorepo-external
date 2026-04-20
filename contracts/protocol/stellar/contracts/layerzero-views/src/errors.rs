//! Error types for LayerZero view contracts.

use common_macros::contract_error;

/// Errors for LayerZeroView contract.
#[contract_error]
pub enum LayerZeroViewError {
    /// Invalid packet header (dst_eid mismatch).
    InvalidEID,
}
