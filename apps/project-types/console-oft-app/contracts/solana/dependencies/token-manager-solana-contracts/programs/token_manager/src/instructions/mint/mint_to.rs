use crate::{
    authority::invoke_as_authority, RoleMember, RoleType, SignerKind, TokenManagerStore,
    TokensMinted, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};
use spl_token_2022_interface::instruction::mint_to_checked;

/// Minter mints to a token account (EVM `mint`). Needs this root's Mint signer to hold the mint
/// authority, alone or as a member of a 1-of-n native multisig passed as `mint_multisig` (for
/// example, one shared with a Console OFT's `oft_store`). Token-2022 rejects a frozen destination,
/// so the allowlist is enforced through the account's freeze state, as for any credit.
#[rbac::only_role(role = RoleType::Minter, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct MintTo<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This root's Mint signer PDA; Token-2022 checks it is, or alone meets, the mint
    /// authority.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::Mint as u8]], bump)]
    pub mint_signer: UncheckedAccount<'info>,

    /// CHECK: The mint authority when it is a 1-of-n native multisig with the Mint signer as a
    /// member; omit when the Mint signer is the authority itself. Token-2022 checks it.
    pub mint_multisig: Option<UncheckedAccount<'info>>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Token-2022 checks its owner, mint and that it is not frozen.
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
}

impl MintTo<'_> {
    pub fn apply(ctx: &mut Context<Self>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        let (program, mint, token_account) =
            (a.token_program.key(), a.mint.key(), a.token_account.key());
        invoke_as_authority(
            &a.token_manager.key(),
            SignerKind::Mint,
            &a.mint_signer,
            ctx.bumps.mint_signer,
            a.mint_multisig.as_deref(),
            |authority, signers| {
                mint_to_checked(
                    &program,
                    &mint,
                    &token_account,
                    authority,
                    signers,
                    amount,
                    a.mint.decimals,
                )
            },
            vec![
                a.mint.to_account_info(),
                a.token_account.to_account_info(),
                a.token_program.to_account_info(),
            ],
        )?;
        emit_cpi!(TokensMinted {
            token_manager: a.token_manager.key(),
            token_account,
            amount,
            authority: a.authority.key(),
        });
        Ok(())
    }
}
