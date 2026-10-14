use crate::{
    authority::invoke_as, PermanentDelegateBurned, RoleMember, RoleType, SignerKind,
    TokenManagerStore, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};
use spl_token_2022_interface::{
    extension::{
        permissioned_burn::PermissionedBurnConfig, BaseStateWithExtensions, StateWithExtensions,
    },
    state::Mint as MintState,
};

/// EVM `burn(from)`: burn from any account as the Permanent Delegate. While the mint has a PB
/// authority, Token-2022 accepts only a PB-approved burn, so this root's PB signer co-signs as the
/// approval (Token-2022 rejects it unless it is that authority). PdBurner alone authorizes it:
/// Burner is for `permissioned_burn`, a holder burning its own tokens.
#[rbac::only_role(role = RoleType::PdBurner, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct PdBurn<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This root's PD signer PDA; Token-2022 checks it is the mint's permanent delegate.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::PermanentDelegate as u8]], bump)]
    pub pd_signer: UncheckedAccount<'info>,

    /// CHECK: This root's PB signer PDA; signs only while the mint has a PB authority.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::PermissionedBurn as u8]], bump)]
    pub pb_signer: UncheckedAccount<'info>,

    /// Token-2022 checks its owner and that it is the account's mint.
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Token-2022 checks its owner and mint when burning from it.
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
}

impl PdBurn<'_> {
    pub fn apply(ctx: &mut Context<Self>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        let state = a.token_manager.key();

        let pd = (SignerKind::PermanentDelegate, ctx.bumps.pd_signer);
        let pb = (SignerKind::PermissionedBurn, ctx.bumps.pb_signer);

        let (ix, signers) = if !a.has_pb_authority()? {
            let ix = spl_token_2022_interface::instruction::burn_checked(
                &a.token_program.key(),
                &a.token_account.key(),
                &a.mint.key(),
                &a.pd_signer.key(),
                &[],
                amount,
                a.mint.decimals,
            )?;
            (ix, vec![pd])
        } else {
            let ix =
                spl_token_2022_interface::extension::permissioned_burn::instruction::burn_checked(
                    &a.token_program.key(),
                    &a.token_account.key(),
                    &a.mint.key(),
                    &a.pb_signer.key(),
                    &a.pd_signer.key(),
                    &[],
                    amount,
                    a.mint.decimals,
                )?;
            (ix, vec![pd, pb])
        };

        invoke_as(
            &state,
            &signers,
            &ix,
            &[
                a.token_account.to_account_info(),
                a.mint.to_account_info(),
                a.pb_signer.to_account_info(),
                a.pd_signer.to_account_info(),
                a.token_program.to_account_info(),
            ],
        )?;
        emit_cpi!(PermanentDelegateBurned {
            token_manager: state,
            authority: a.authority.key(),
            token_account: a.token_account.key(),
            amount
        });
        Ok(())
    }

    /// Whether the mint has a live PB authority, which selects the burn path as Token-2022 does.
    fn has_pb_authority(&self) -> Result<bool> {
        let info = self.mint.to_account_info();
        let data = info.try_borrow_data()?;
        let mint = StateWithExtensions::<MintState>::unpack(&data)?;
        Ok(mint
            .get_extension::<PermissionedBurnConfig>()
            .is_ok_and(|config| Option::<Pubkey>::from(config.authority).is_some()))
    }
}
