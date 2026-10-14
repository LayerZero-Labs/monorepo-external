//! TEST ONLY — not a policy hook and not deployable as access control.
//! Exercises native transfers with absent, empty and destination-seeded manifests. Tests seed
//! the manifest directly; this fixture deliberately has no configuration/administration API.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_discriminator::SplDiscriminate;
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_token_2022::extension::{
    transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions,
};
use spl_transfer_hook_interface::{
    get_extra_account_metas_address, instruction::ExecuteInstruction,
};

declare_id!("93MB2qRDNVLxbmmPuYpLdAqn3u2x9ZhaVZK5wELHueP8");

#[program]
pub mod transfer_hook_fixture {
    use super::*;

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn execute<'info>(ctx: Context<'info, Execute<'info>>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        for account in [a.source.to_account_info(), a.destination.to_account_info()] {
            let data = account.try_borrow_data()?;
            let state = StateWithExtensions::<spl_token_2022::state::Account>::unpack(&data)?;
            require!(
                bool::from(state.get_extension::<TransferHookAccount>()?.transferring),
                FixtureError::NotTransferring
            );
        }
        if let Some(manifest) = ctx.remaining_accounts.first() {
            require_keys_eq!(*manifest.key, get_extra_account_metas_address(&a.mint.key(), &ID));
            require_keys_eq!(*manifest.owner, ID);
            let mut accounts = vec![
                a.source.to_account_info(),
                a.mint.to_account_info(),
                a.destination.to_account_info(),
                a.authority.to_account_info(),
            ];
            accounts.extend_from_slice(ctx.remaining_accounts);
            let data = spl_transfer_hook_interface::instruction::TransferHookInstruction::Execute {
                amount,
            }
            .pack();
            ExtraAccountMetaList::check_account_infos::<ExecuteInstruction>(
                &accounts,
                &data,
                &ID,
                &manifest.try_borrow_data()?,
            )?;
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(owner = spl_token_2022::ID, constraint = source.mint == mint.key())]
    pub source: InterfaceAccount<'info, TokenAccount>,
    #[account(owner = spl_token_2022::ID)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(owner = spl_token_2022::ID, constraint = destination.mint == mint.key())]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Authenticated by native Token-2022; the transferring flags are checked above.
    pub authority: UncheckedAccount<'info>,
}

#[error_code]
pub enum FixtureError {
    NotTransferring,
}
