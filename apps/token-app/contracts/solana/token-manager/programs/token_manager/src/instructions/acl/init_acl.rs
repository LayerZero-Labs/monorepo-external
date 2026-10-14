use super::helpers::write_acl_manifests;
use crate::{errors::TokenManagerError, AclInitialized, RoleMember, RoleType, TokenManagerStore};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use pubkey_policy_interface::PubkeyPolicy;
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_token_2022_interface::{
    extension::{
        default_account_state::DefaultAccountState, BaseStateWithExtensions, StateWithExtensions,
    },
    state::{AccountState, Mint as MintState},
};
use token_acl_interface::{FREEZE_EXTRA_ACCOUNT_METAS_SEED, THAW_EXTRA_ACCOUNT_METAS_SEED};
use token_manager_interface::acl::ACL_EXTRA_COUNT;

/// Binds `pubkey_policy` into both gate manifests, creating or overwriting them. Which policy, and
/// keeping it the same as other consumers', is the DefaultAdmin's call. Requires only that
/// DefaultAccountState is Frozen and that the policy is for this mint, which the gate would
/// otherwise refuse on every call: the manifests are inert until Token ACL names this program as
/// the mint's gate, so they can be written before or after the ACL handoff.
#[rbac::only_role(role = RoleType::DefaultAdmin, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct InitAcl<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub authority: Signer<'info>,

    #[account(owner = spl_token_2022_interface::ID)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: The pubkey policy the admin binds, under whichever program owns it; both are written
    /// into the manifests. It must already exist (checked in `apply`), since its owner is recorded
    /// as the program its records live under.
    pub pubkey_policy: UncheckedAccount<'info>,

    /// CHECK: Deterministic gate-owned SPL manifest.
    #[account(init_if_needed, payer = payer, space = ExtraAccountMetaList::size_of(ACL_EXTRA_COUNT).unwrap(),
        seeds = [THAW_EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
    pub thaw_metas: UncheckedAccount<'info>,

    /// CHECK: Deterministic gate-owned SPL manifest.
    #[account(init_if_needed, payer = payer, space = ExtraAccountMetaList::size_of(ACL_EXTRA_COUNT).unwrap(),
        seeds = [FREEZE_EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
    pub freeze_metas: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl InitAcl<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        // Token ACL registration requires the DefaultAccountState extension but not a Frozen
        // default. Without it new accounts start thawed and bypass the thaw gate.
        let mint_info = ctx.accounts.mint.to_account_info();
        let mint_data = mint_info.try_borrow_data()?;
        let mint = StateWithExtensions::<MintState>::unpack(&mint_data)?;
        require!(
            mint.get_extension::<DefaultAccountState>()?.state == AccountState::Frozen as u8,
            TokenManagerError::DefaultAccountStateNotFrozen
        );

        // A policy not created yet is owned by the System Program, which would be recorded as the
        // policy program.
        let policy =
            PubkeyPolicy::try_deserialize(&mut &ctx.accounts.pubkey_policy.try_borrow_data()?[..])?;
        require_keys_eq!(policy.mint, ctx.accounts.mint.key(), TokenManagerError::WrongPolicyMint);

        write_acl_manifests(
            &ctx.accounts.thaw_metas,
            &ctx.accounts.freeze_metas,
            &ctx.accounts.pubkey_policy.key(),
            ctx.accounts.pubkey_policy.owner,
        )?;

        emit_cpi!(AclInitialized {
            token_manager: ctx.accounts.token_manager.key(),
            pubkey_policy: ctx.accounts.pubkey_policy.key(),
            authority: ctx.accounts.authority.key()
        });
        Ok(())
    }
}
