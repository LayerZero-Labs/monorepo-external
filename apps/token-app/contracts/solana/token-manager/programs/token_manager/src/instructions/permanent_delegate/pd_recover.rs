use crate::{
    instructions::{
        acl::helpers::set_frozen,
        pause::{is_paused, set_paused},
    },
    FundsRecovered, RoleMember, RoleType, SignerKind, TokenManagerStore, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};
use token_acl_interface::TOKEN_ACL_ID;

/// EVM `recoverFunds`, with frozen standing in for blocked: move a frozen account's funds.
/// DefaultAdmin only, as `recoverFunds` is: Freezer can freeze any funded account, so a separate
/// recovery role would let two non-admin roles together seize any balance.
/// Thaw → PD transfer → refreeze in one instruction, so the source ends frozen as it started. The
/// source must be frozen; Token-2022 rejects thawing one that is not. A paused mint is resumed
/// around the transfer and paused again, which needs this root's Pause signer to hold the pause
/// authority, or to be one member of a 1-of-n native multisig that holds it, passed as
/// `pause_multisig` (Token-2022 rejects the resume otherwise); without the Pausable extension a
/// mint is never paused.
///
/// Remaining accounts are ONLY the mint's transfer-hook accounts (hook program, its manifest and
/// the extras it resolves), from which `invoke_transfer_checked` builds the hook's account list.
/// The hook must let the Permanent Delegate through; `pubkey_policy_hook` does.
#[rbac::only_role(role = RoleType::DefaultAdmin, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct PdRecover<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Box<Account<'info, TokenManagerStore>>,

    /// CHECK: This root's PD signer PDA; Token-2022 checks it is the mint's permanent delegate.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::PermanentDelegate as u8]], bump)]
    pub pd_signer: UncheckedAccount<'info>,

    /// CHECK: This root's Acl signer PDA, expected to be the MintConfig logical admin; Token ACL
    /// enforces that.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::Acl as u8]], bump)]
    pub acl_signer: UncheckedAccount<'info>,

    /// CHECK: This root's Pause signer PDA, expected to be the pause authority when the mint is
    /// paused; Token-2022 enforces that.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::Pause as u8]], bump)]
    pub pause_signer: UncheckedAccount<'info>,

    /// CHECK: The pause authority when it is a 1-of-n native multisig with the Pause signer as a
    /// member; omit when the Pause signer is the authority itself. Token-2022 checks it is the
    /// mint's pause authority and that the Pause signer alone meets its threshold.
    pub pause_multisig: Option<UncheckedAccount<'info>>,

    /// Mutable because resuming and re-pausing a paused mint writes its PausableConfig.
    /// Token-2022 checks its owner and that it is both accounts' mint.
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// Typed so Anchor rejects `source == destination`; Token-2022 checks owner and mint.
    #[account(mut)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: This mint's MintConfig; Token ACL checks its owner and stored mint.
    pub mint_config: UncheckedAccount<'info>,

    /// CHECK: Pinned Token ACL, never caller-selected.
    #[account(address = TOKEN_ACL_ID, executable)]
    pub acl_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
}

impl<'info> PdRecover<'info> {
    pub fn apply(ctx: &mut Context<'info, Self>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        let state = a.token_manager.key();
        let was_paused = is_paused(&a.mint.to_account_info())?;

        a.set_frozen(false, ctx.bumps.acl_signer)?;
        if was_paused {
            a.set_paused(false, ctx.bumps.pause_signer)?;
        }

        spl_token_2022::onchain::invoke_transfer_checked(
            &a.token_program.key(),
            a.source.to_account_info(),
            a.mint.to_account_info(),
            a.destination.to_account_info(),
            a.pd_signer.to_account_info(),
            ctx.remaining_accounts,
            amount,
            a.mint.decimals,
            &[&[
                SIGNER_SEED,
                state.as_ref(),
                &[SignerKind::PermanentDelegate as u8],
                &[ctx.bumps.pd_signer],
            ]],
        )?;

        if was_paused {
            a.set_paused(true, ctx.bumps.pause_signer)?;
        }
        a.set_frozen(true, ctx.bumps.acl_signer)?;

        emit_cpi!(FundsRecovered {
            token_manager: state,
            authority: ctx.accounts.authority.key(),
            source: ctx.accounts.source.key(),
            destination: ctx.accounts.destination.key(),
            amount
        });
        Ok(())
    }

    fn set_paused(&self, paused: bool, bump: u8) -> Result<()> {
        set_paused(
            paused,
            &self.token_manager.key(),
            &self.pause_signer,
            bump,
            self.pause_multisig.as_deref(),
            &self.mint.to_account_info(),
            &self.token_program,
        )
    }

    fn set_frozen(&self, frozen: bool, bump: u8) -> Result<()> {
        set_frozen(
            frozen,
            &self.token_manager.key(),
            &self.acl_signer,
            bump,
            &self.mint.to_account_info(),
            &self.source.to_account_info(),
            &self.mint_config,
            &self.token_program.to_account_info(),
            &self.acl_program,
        )
    }
}
