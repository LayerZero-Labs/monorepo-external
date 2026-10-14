use std::iter::once;

use crate::{
    authority::invoke_as, errors::TokenManagerError, PermissionedBurnApproved, RoleMember,
    RoleType, SignerKind, TokenManagerStore, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};

/// Approval and token spending are separate capabilities. `authority` approves;
/// `source_authority` is the owner/delegate/PD authenticated by Token-2022.
/// Remaining accounts are ONLY native multisig members for source_authority.
#[rbac::only_role(role = RoleType::Burner, state = token_manager, authority = authority)]
#[derive(Accounts)]
pub struct PermissionedBurn<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This state's PB signer PDA; Token-2022 checks it is the mint's PB authority.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::PermissionedBurn as u8]], bump)]
    pub pb_signer: UncheckedAccount<'info>,

    /// Token-2022 checks its owner and that it is the account's mint.
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Token-2022 checks its owner and mint when burning from it.
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    /// CHECK: Token-2022 validates owner/delegate/PD and single/multisig signatures.
    pub source_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
}

impl<'info> PermissionedBurn<'info> {
    pub fn apply(ctx: &mut Context<'info, Self>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        // Approval must not create spending authorization. invoke_signed makes the PB signer a
        // signer inside the CPI, so it must not stand in for the source: neither as
        // `source_authority` nor as one of its multisig members. Every other source signer must
        // already have signed, or the runtime rejects the CPI as a privilege escalation.
        require!(
            once(a.source_authority.as_ref())
                .chain(ctx.remaining_accounts)
                .all(|signer| signer.key() != a.pb_signer.key()),
            TokenManagerError::MissingBurnSourceSignature
        );
        let signers: Vec<&Pubkey> = ctx.remaining_accounts.iter().map(|a| a.key).collect();
        let mut infos = vec![
            a.token_account.to_account_info(),
            a.mint.to_account_info(),
            a.pb_signer.to_account_info(),
            a.source_authority.to_account_info(),
            a.token_program.to_account_info(),
        ];
        infos.extend_from_slice(ctx.remaining_accounts);
        let token_manager = a.token_manager.key();

        let ix = spl_token_2022_interface::extension::permissioned_burn::instruction::burn_checked(
            &a.token_program.key(),
            &a.token_account.key(),
            &a.mint.key(),
            &a.pb_signer.key(),
            &a.source_authority.key(),
            &signers,
            amount,
            a.mint.decimals,
        )?;

        invoke_as(
            &token_manager,
            &[(SignerKind::PermissionedBurn, ctx.bumps.pb_signer)],
            &ix,
            &infos,
        )?;
        // `emit!`, not `emit_cpi!`: this runs on every PB burn, so avoid the extra self-CPI.
        emit!(PermissionedBurnApproved {
            token_manager,
            authority: a.authority.key(),
            token_account: a.token_account.key(),
            source_authority: a.source_authority.key(),
            amount
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use anchor_lang::{prelude::*, InstructionData};
    use token_manager_interface::burn;

    /// Consumers invoke this instruction through the interface builder, so it must encode exactly
    /// what this program decodes.
    #[test]
    fn the_interface_builder_encodes_this_instruction() {
        let keys = burn::PermissionedBurn {
            authority: Pubkey::new_unique(),
            token_manager: Pubkey::new_unique(),
            pb_signer: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            token_account: Pubkey::new_unique(),
            source_authority: Pubkey::new_unique(),
            role_member: Pubkey::new_unique(),
        };
        let ix = keys.instruction(crate::ID, 7);
        let accounts = crate::accounts::PermissionedBurn {
            authority: keys.authority,
            token_manager: keys.token_manager,
            pb_signer: keys.pb_signer,
            mint: keys.mint,
            token_account: keys.token_account,
            source_authority: keys.source_authority,
            token_program: spl_token_2022_interface::ID,
            role_member: keys.role_member,
        };
        assert_eq!(ix.accounts, accounts.to_account_metas(None));
        assert_eq!(ix.data, crate::instruction::PermissionedBurn { amount: 7 }.data());
    }
}
