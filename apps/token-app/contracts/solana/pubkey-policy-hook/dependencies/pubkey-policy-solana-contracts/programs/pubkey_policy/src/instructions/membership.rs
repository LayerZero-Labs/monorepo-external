use crate::errors::PubkeyPolicyError;
use anchor_lang::prelude::*;
use pubkey_policy_interface::{Membership, SubjectRecord};

/// Applies one flag update to `record`. Callers' account constraints enforce the role and the
/// policy-scoped seeds, and each passes a single-flag update rather than replacement bytes, so one
/// list's authority cannot change the other list.
///
/// A write that changes nothing is rejected. A new record starts all-false, like an absent one, so
/// clearing a flag that was never set is rejected too. Records are never closed; clearing both
/// flags leaves an all-false record.
pub(super) fn update_membership(
    record: &mut Account<SubjectRecord>,
    policy: &Pubkey,
    subject: &Pubkey,
    update: impl FnOnce(&mut Membership),
) -> Result<Membership> {
    let mut membership = record.membership;
    update(&mut membership);
    require!(membership != record.membership, PubkeyPolicyError::MembershipStateIdempotent);
    record.set_inner(SubjectRecord { policy: *policy, subject: *subject, membership });
    Ok(membership)
}
