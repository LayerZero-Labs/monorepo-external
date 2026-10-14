//! Token ACL's permissionless thaw/freeze gate. It approves only accounts that hold nothing, in
//! either direction; anything with a balance is the Freezer/Thawer roles' decision.
//!
//! The gate checks the policy answer, the balance, that the policy is this mint's, and that the
//! token account is the subject's account of this mint. Token ACL resolves the extra accounts
//! (pubkey policy, its owning policy program, subject record) from this mint's manifest, which only
//! `init_acl` writes, and itself checks the token owner, the MintConfig's mint and gating program,
//! and its transient flag. `init_acl` already refuses another mint's policy; the mint and owner
//! checks here keep the gate correct on its own, whatever Token ACL build calls it. The gate writes
//! nothing and makes no CPI, so calling it directly has no effect.
use crate::errors::TokenManagerError;
use anchor_lang::prelude::*;
use pubkey_policy_interface::{PolicyError, ValidatedPubkeyPolicy};
use spl_token_2022_interface::{extension::StateWithExtensions, state::Account as TokenAccount};
use token_manager_interface::acl::{self, Emptiness};

/// Token ACL's five base accounts, the manifest, then the three extras it resolves.
#[derive(Accounts)]
pub struct Gate<'info> {
    /// CHECK: ACL's payer; not the policy subject.
    pub caller: UncheckedAccount<'info>,

    /// CHECK: Read for emptiness and checked to be `token_account_owner`'s account of `mint`.
    pub token_account: UncheckedAccount<'info>,

    /// CHECK: Token ACL checks it against the MintConfig.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: The token account's owner, the policy subject; checked against the account.
    pub token_account_owner: UncheckedAccount<'info>,

    /// CHECK: Token ACL's transient flag.
    pub flag: UncheckedAccount<'info>,

    /// CHECK: The canonical manifest Token ACL resolved the extras from.
    pub extra_account_metas: UncheckedAccount<'info>,

    /// CHECK: The policy the manifest binds; decoded and checked to be this mint's in the handler.
    pub pubkey_policy: UncheckedAccount<'info>,

    /// CHECK: The program that owns the policy and its records, named by the manifest for the
    /// record's derivation. The reader takes the program from the policy's owner, so a manifest
    /// naming another program fails the record check.
    pub policy_program: UncheckedAccount<'info>,

    /// CHECK: Canonical subject record; `ValidatedPubkeyPolicy::read` checks its address and
    /// owner.
    pub record: UncheckedAccount<'info>,
}

impl Gate<'_> {
    /// Approve an empty account whose owner the policy does not block. Empty is what keeps a
    /// public thaw from releasing value an admin locked; it is a proxy for a newly created
    /// account, not a freshness proof.
    pub fn can_thaw(ctx: &Context<Self>) -> Result<()> {
        require!(!ctx.accounts.subject_blocked()?, PolicyError::Blocked);
        ctx.accounts.require_empty()
    }

    /// Approve re-sealing an empty account whose owner the policy blocks, e.g. one opened before
    /// the block landed. An account this cannot fully parse (native, or an unrecognized extension)
    /// is left thawed rather than frozen; Freezer remains the escape hatch.
    pub fn can_freeze(ctx: &Context<Self>) -> Result<()> {
        require!(ctx.accounts.subject_blocked()?, PolicyError::NotBlocked);
        ctx.accounts.require_empty()
    }

    fn subject_blocked(&self) -> Result<bool> {
        let validated = ValidatedPubkeyPolicy::read(
            &self.pubkey_policy,
            &self.record,
            &self.token_account_owner.key(),
        )?;
        require_keys_eq!(validated.mint(), self.mint.key(), TokenManagerError::WrongPolicyMint);
        Ok(validated.is_blocked())
    }

    /// The account must be the subject's account of this mint, so the policy answer is about its
    /// owner, and empty.
    fn require_empty(&self) -> Result<()> {
        let data = self.token_account.try_borrow_data()?;
        let account = StateWithExtensions::<TokenAccount>::unpack(&data)?;
        require!(
            account.base.mint == self.mint.key()
                && account.base.owner == self.token_account_owner.key(),
            TokenManagerError::InvalidTokenAccount
        );
        validate_empty_account(&data)
    }
}

/// Requires an empty token account ([`acl::account_emptiness`]), with this program's errors.
pub fn validate_empty_account(data: &[u8]) -> Result<()> {
    match acl::account_emptiness(data)? {
        Emptiness::Empty => Ok(()),
        Emptiness::Funded => err!(TokenManagerError::NonEmptyAccount),
        Emptiness::Unsupported => err!(TokenManagerError::UnsupportedExtension),
    }
}
