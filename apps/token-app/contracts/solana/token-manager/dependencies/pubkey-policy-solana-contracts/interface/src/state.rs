//! A pubkey policy (one initializer's blacklist/whitelist oracle for one mint) and its subject
//! records, one per (policy, subject), created on first write and never closed.
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub enum PubkeyPolicyMode {
    Open,
    Blacklist,
    Whitelist,
}

impl PubkeyPolicyMode {
    pub fn allows(self, membership: Membership) -> bool {
        match self {
            Self::Open => true,
            Self::Blacklist => !membership.blacklisted,
            Self::Whitelist => membership.whitelisted,
        }
    }
}

/// Policy at `[PUBKEY_POLICY_SEED, mint, initializer]`. Anyone may create one, and it binds nothing
/// until a consumer selects it. The initializer names its DefaultAdmin at creation.
#[account]
#[derive(InitSpace, rbac::DefaultAdmin)]
pub struct PubkeyPolicy {
    pub mint: Pubkey,
    pub current_default_admin: Pubkey,
    pub pending_default_admin: Pubkey,
    pub mode: PubkeyPolicyMode,
}

/// One subject's flags. They are independent and persist across mode changes; the mode decides
/// which one counts.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, InitSpace,
)]
pub struct Membership {
    pub blacklisted: bool,
    pub whitelisted: bool,
}

/// The record at `[SUBJECT_SEED, policy, subject]`. Its address is the authoritative binding and
/// the reader checks only that; `policy` and `subject` are stored so records can be enumerated with
/// `getProgramAccounts`, which returns account data but not the seeds behind an address.
#[account]
#[derive(Debug, PartialEq, Eq, InitSpace)]
pub struct SubjectRecord {
    pub policy: Pubkey,
    pub subject: Pubkey,
    pub membership: Membership,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_evaluate_independent_memberships() {
        for blacklisted in [false, true] {
            for whitelisted in [false, true] {
                let membership = Membership { blacklisted, whitelisted };
                assert!(PubkeyPolicyMode::Open.allows(membership));
                assert_eq!(PubkeyPolicyMode::Blacklist.allows(membership), !blacklisted);
                assert_eq!(PubkeyPolicyMode::Whitelist.allows(membership), whitelisted);
            }
        }
    }
}
