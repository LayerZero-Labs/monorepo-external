use crate::{events::PubkeyPolicySet, OFTStore, RoleMember, RoleType};
use anchor_lang::prelude::*;

/// Selects, replaces, or disables the pubkey policy used by OFT receive screening.
///
/// The selected account is the one receive accepts, and the program that owns it is trusted for
/// its subject records, so a policy under a new program is selected the same way. The policy also
/// predicts the mint's Token ACL gate for inline thaw, so the gate must admit whoever it allows;
/// keeping them consistent is the admins' job, since a gate that refuses fails the receive rather
/// than redirecting. The gate may bind a different policy.
#[rbac::only_role(role = RoleType::DefaultAdmin, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct SetPubkeyPolicy<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: The policy to accept, or none to disable screening. Receive decodes it and checks it
    /// is for this OFT's mint.
    pub pubkey_policy: Option<UncheckedAccount<'info>>,
}

impl SetPubkeyPolicy<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let policy = ctx.accounts.pubkey_policy.as_ref().map(|policy| policy.key());
        // Unlike EVM, a policy without a redirect escrow is allowed: a blocked delivery then fails
        // with `CreditBlocked`, leaving the payload uncleared to retry once an escrow is set.
        ctx.accounts.oft_store.pubkey_policy = policy;
        emit_cpi!(PubkeyPolicySet {
            oft_store: ctx.accounts.oft_store.key(),
            pubkey_policy: policy
        });
        Ok(())
    }
}
