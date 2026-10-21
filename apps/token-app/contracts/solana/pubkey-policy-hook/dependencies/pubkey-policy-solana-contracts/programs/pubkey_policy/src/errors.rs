use anchor_lang::prelude::*;

/// Continues the shared 8000+ policy range; this program raises none of the consumer-side
/// `PolicyError` variants.
#[error_code(offset = 8005)]
pub enum PubkeyPolicyError {
    #[msg("Policy mode is already set to the requested value")]
    ModeAlreadySet,
    #[msg("Membership write leaves the subject's state unchanged")]
    MembershipStateIdempotent,
}
