use anchor_lang::error_code;

/// Custom error codes for OApp operations
// The offset keeps these codes distinct from RBAC's and the consuming program's own errors.
#[error_code(offset = 11000)]
pub enum OAppError {
    #[msg("Invalid options")]
    InvalidOptions,
    #[msg("Invalid options length")]
    InvalidOptionsLength,
    #[msg("No peer set for the given EID")]
    NoPeer,
    #[msg("TLV update would change entry size")]
    TlvLengthMismatch,
    #[msg("Planner output must be a writable, empty scratch account owned by the planner")]
    InvalidPlanOutput,
}
