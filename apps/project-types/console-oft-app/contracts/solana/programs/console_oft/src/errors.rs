// Clear of the first-party ranges this program links or CPIs into: RBAC 6000+, token-manager,
// pubkey-policy-hook and pubkey-policy 7000–10999, OApp 11000+. `declare_policy_errors!` makes
// the shared policy errors (8000-8004) the policy reader raises decode through this program's IDL.
pubkey_policy_interface::declare_policy_errors! {
pub enum OFTError {
    // ============================== Core ==============================
    /// remaining_accounts is shorter than what the instruction needs to slice
    #[msg("Insufficient remaining accounts")]
    InsufficientRemainingAccounts = 13000,
    #[msg("Mint decimals less than shared decimals")]
    InvalidDecimals,
    #[msg("Invalid ExtraAccountMetaList")]
    InvalidExtraAccountMetaList,
    #[msg("Invalid OFT message")]
    InvalidMessage,
    #[msg("Invalid mint authority")]
    InvalidMintAuthority,
    #[msg("Invalid sender")]
    InvalidSender,
    #[msg("Invalid clock timestamp")]
    InvalidTimestamp,
    #[msg("Invalid token destination")]
    InvalidTokenDest,
    #[msg("Invalid transfer hook program")]
    InvalidTransferHookProgram,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Slippage exceeded")]
    SlippageExceeded,

    // ============================== Fee ===============================
    #[msg("Fee bps exceeds max")]
    InvalidFee,
    /// EVM alignment: IFeeHandler.InvalidFeeDeposit
    #[msg("Invalid fee deposit")]
    InvalidFeeDeposit,

    // ============================== Pause =============================
    #[msg("Pause state unchanged")]
    PauseStateIdempotent,
    #[msg("OFT is paused")]
    Paused,

    // =========================== Rate Limiter =========================
    /// EVM alignment: IRateLimiter.ExemptionStateIdempotent
    #[msg("Exemption state unchanged")]
    ExemptionStateIdempotent,
    /// EVM alignment: IRateLimiter.LastUpdatedInFuture
    #[msg("Last updated in future")]
    LastUpdatedInFuture,
    #[msg("Rate limit exceeded")]
    RateLimitExceeded,
    #[msg("Rate limit not initialized")]
    RateLimitNotInitialized,

    // ======================== Credit Redirect =========================
    #[msg("Redirect escrow is frozen")]
    RedirectEscrowFrozen,
    #[msg("Invalid redirect escrow")]
    InvalidRedirectEscrow,
    #[msg("Invalid credit account plan")]
    InvalidCreditAccountPlan,

    // ============================== Appended ==============================
    // Codes are positional: append new variants here rather than inserting them by domain.
    #[msg("Fee deposit account is required when the send collects a fee or decimal dust")]
    MissingFeeDeposit,
    #[msg("Invalid canonical ACL mint config")]
    InvalidAclMintConfig,
    #[msg("Missing, unexpected or unselected pubkey policy accounts")]
    InvalidPubkeyPolicy,
    #[msg("Pubkey policy is for another mint")]
    InvalidPubkeyPolicyMint,
    #[msg("Recipient is blocked and credit redirect is disabled")]
    CreditBlocked = 13027,
    #[msg("Burn policy is not this OFT's token manager root, or manager is not its program")]
    InvalidBurnAuthority,
    #[msg("Missing or stale ACL thaw manifest; sync_acl_gating_program after a gate change")]
    InvalidAclThawMetas,
    #[msg("Missing or invalid canonical ACL invocation accounts")]
    InvalidAclAccounts,
    #[msg("Invalid token account for ACL activation")]
    InvalidAclTokenAccount,
    #[msg("Fee deposit is frozen")]
    FeeDepositFrozen,
    #[msg("Token-2022 transfer fee is non-zero")]
    TransferFeeActive,
    #[msg("Active PermissionedBurn requires the burn policy, role, manager and signer accounts")]
    MissingBurnAccounts,
    #[msg("PermissionedBurn did not reduce supply by the burned amount")]
    BurnNotApplied,
    #[msg("Token account extensions are unsupported for ACL activation")]
    UnsupportedAclTokenAccount,
    #[msg("Fee config account is not this OFT's config for the requested ID")]
    InvalidFeeConfigAccount,
}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linked_error_ranges_do_not_overlap() {
        let ranges: [(u32, u32); 4] = [
            (rbac::RbacError::CallerNotPendingAdmin.into(), rbac::RbacError::Unauthorized.into()),
            (
                pubkey_policy_interface::PolicyError::WrongRecord.into(),
                pubkey_policy_interface::PolicyError::NotBlocked.into(),
            ),
            (oapp::OAppError::InvalidOptions.into(), oapp::OAppError::InvalidPlanOutput.into()),
            (
                OFTError::InsufficientRemainingAccounts.into(),
                OFTError::InvalidFeeConfigAccount.into(),
            ),
        ];
        assert_eq!(ranges.map(|(start, _)| start), [6000, 8000, 11000, 13000]);
        for (start, end) in ranges {
            assert!(start <= end && end < start + 1000);
        }
        for pair in ranges.windows(2) {
            assert!(pair[0].1 < pair[1].0);
        }
        assert_eq!(u32::from(OFTError::InvalidTokenDest), 13007);
        // The removed record error's code stays unused; later codes must not shift.
        assert_eq!(u32::from(OFTError::CreditBlocked), 13027);
        assert_eq!(u32::from(OFTError::InvalidFeeConfigAccount), 13037);
        assert_eq!(u32::from(OFTError::WrongRecord), 8000);
        assert_eq!(u32::from(rbac::RbacError::Unauthorized), 6007);
    }
}
