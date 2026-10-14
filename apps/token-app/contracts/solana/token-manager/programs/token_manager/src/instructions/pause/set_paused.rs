use crate::{
    authority::invoke_as_authority, errors::TokenManagerError, PauseStateChanged, RoleMember,
    RoleType, SignerKind, TokenManagerStore, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};
use spl_token_2022_interface::{
    extension::{
        pausable::{instruction as pausable, PausableConfig},
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Mint as MintState,
};

/// Live pause state; a mint without the Pausable extension is never paused.
pub(crate) fn is_paused(mint: &AccountInfo) -> Result<bool> {
    let data = mint.try_borrow_data()?;
    let mint = StateWithExtensions::<MintState>::unpack(&data)?;
    Ok(mint.get_extension::<PausableConfig>().is_ok_and(|config| config.paused.into()))
}

/// Pause or resume `mint` as `state`'s Pause signer, directly or through `pause_multisig` (see
/// [`invoke_as_authority`]).
pub(crate) fn set_paused<'info>(
    paused: bool,
    state: &Pubkey,
    pause_signer: &AccountInfo<'info>,
    bump: u8,
    pause_multisig: Option<&AccountInfo<'info>>,
    mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
) -> Result<()> {
    let toggle = if paused { pausable::pause } else { pausable::resume };
    invoke_as_authority(
        state,
        SignerKind::Pause,
        pause_signer,
        bump,
        pause_multisig,
        |authority, signers| toggle(token_program.key, mint.key, authority, signers),
        vec![mint.clone(), token_program.clone()],
    )
}

/// Pauser pauses the mint (EVM `pause`). Needs this root's Pause signer to hold the mint's pause
/// authority, alone or as a member of a 1-of-n native multisig passed as `pause_multisig`. Fails
/// with `PauseStateIdempotent` on an already paused mint, as EVM's `pause` does.
#[rbac::only_role(role = RoleType::Pauser, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct Pause<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This root's Pause signer PDA; Token-2022 checks it is, or alone meets, the mint's
    /// pause authority.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::Pause as u8]], bump)]
    pub pause_signer: UncheckedAccount<'info>,

    /// CHECK: The pause authority when it is a 1-of-n native multisig with the Pause signer as a
    /// member; omit when the Pause signer is the authority itself. Token-2022 checks it.
    pub pause_multisig: Option<UncheckedAccount<'info>>,

    /// Token-2022 checks its owner and that it has the Pausable extension.
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
}

impl Pause<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let a = &ctx.accounts;
        require!(!is_paused(&a.mint.to_account_info())?, TokenManagerError::PauseStateIdempotent);
        set_paused(
            true,
            &a.token_manager.key(),
            &a.pause_signer,
            ctx.bumps.pause_signer,
            a.pause_multisig.as_deref(),
            &a.mint.to_account_info(),
            &a.token_program,
        )?;
        emit_cpi!(PauseStateChanged {
            token_manager: a.token_manager.key(),
            paused: true,
            authority: a.authority.key(),
        });
        Ok(())
    }
}

/// Unpauser resumes the mint (EVM `unpause`), under the same pause-authority setup as `Pause`.
/// Fails with `PauseStateIdempotent` on a mint that is not paused.
#[rbac::only_role(role = RoleType::Unpauser, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct Unpause<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This root's Pause signer PDA; Token-2022 checks it is, or alone meets, the mint's
    /// pause authority.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::Pause as u8]], bump)]
    pub pause_signer: UncheckedAccount<'info>,

    /// CHECK: The pause authority when it is a 1-of-n native multisig with the Pause signer as a
    /// member; omit when the Pause signer is the authority itself. Token-2022 checks it.
    pub pause_multisig: Option<UncheckedAccount<'info>>,

    /// Token-2022 checks its owner and that it has the Pausable extension.
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
}

impl Unpause<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let a = &ctx.accounts;
        require!(is_paused(&a.mint.to_account_info())?, TokenManagerError::PauseStateIdempotent);
        set_paused(
            false,
            &a.token_manager.key(),
            &a.pause_signer,
            ctx.bumps.pause_signer,
            a.pause_multisig.as_deref(),
            &a.mint.to_account_info(),
            &a.token_program,
        )?;
        emit_cpi!(PauseStateChanged {
            token_manager: a.token_manager.key(),
            paused: false,
            authority: a.authority.key(),
        });
        Ok(())
    }
}
