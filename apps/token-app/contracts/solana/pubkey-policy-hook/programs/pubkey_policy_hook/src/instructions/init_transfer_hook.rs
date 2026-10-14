use crate::{
    account_metas, errors::HookError, TransferHookInitialized, EXTRA_COUNT, EXTRA_METAS_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use pubkey_policy_interface::PubkeyPolicy;
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_token_2022::processor::Processor;
use spl_token_2022_interface::{
    extension::{transfer_hook::TransferHook, BaseStateWithExtensions, StateWithExtensions},
    state::Mint as MintState,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

/// Only the mint's hook-update authority may bind or re-bind the policy, proven exactly as
/// Token-2022 would: a plain signer, a CPI-signing PDA, or a native multisig whose member
/// signatures are the remaining accounts (a multisig's own key never counts). The mint need not
/// name this hook yet: the manifest is inert until it does, so it can be staged before a switch.
/// The policy must be for this mint: the hook refuses any other on every transfer, which would
/// stop the mint's transfers until the binding is fixed, and for good once the hook authority is
/// renounced.
#[event_cpi]
#[derive(Accounts)]
pub struct InitTransferHook<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The mint's hook-update authority, authenticated in the handler. Pass it as a signer
    /// for a plain key or CPI-signing PDA, and as a non-signer for a native multisig, whose member
    /// signers are the remaining accounts.
    pub authority: UncheckedAccount<'info>,

    #[account(owner = spl_token_2022_interface::ID)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: The pubkey policy the hook authority binds, under whichever program owns it; both
    /// are written into the manifest. It must already exist (checked in `apply`), since its owner
    /// is recorded as the program its records live under.
    pub pubkey_policy: UncheckedAccount<'info>,

    /// CHECK: The mint's hook manifest; written only after `authority` is authenticated.
    #[account(
        init_if_needed,
        payer = payer,
        space = ExtraAccountMetaList::size_of(EXTRA_COUNT).unwrap(),
        seeds = [EXTRA_METAS_SEED, mint.key().as_ref()],
        bump,
    )]
    pub extra_account_metas: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl InitTransferHook<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        {
            let mint_info = ctx.accounts.mint.to_account_info();
            let mint_data = mint_info.try_borrow_data()?;
            let mint = StateWithExtensions::<MintState>::unpack(&mint_data)?;
            let hook = mint.get_extension::<TransferHook>()?;
            let expected =
                Option::<Pubkey>::from(hook.authority).ok_or(error!(HookError::Unauthorized))?;
            // Pass Token-2022 as program_id, never this program: validate_owner treats any account
            // owned by program_id with multisig length as a multisig.
            let authority = ctx.accounts.authority.to_account_info();
            Processor::validate_owner(
                &spl_token_2022_interface::ID,
                &expected,
                &authority,
                authority.data_len(),
                ctx.remaining_accounts,
            )
            .map_err(|_| error!(HookError::Unauthorized))?;
        }
        // A policy not created yet is owned by the System Program, which would be recorded as the
        // policy program.
        let policy =
            PubkeyPolicy::try_deserialize(&mut &ctx.accounts.pubkey_policy.try_borrow_data()?[..])?;
        require_keys_eq!(policy.mint, ctx.accounts.mint.key(), HookError::WrongPolicyMint);
        {
            let mut manifest = ctx.accounts.extra_account_metas.try_borrow_mut_data()?;
            manifest.fill(0);
            ExtraAccountMetaList::init::<ExecuteInstruction>(
                &mut manifest,
                &account_metas(
                    &ctx.accounts.pubkey_policy.key(),
                    ctx.accounts.pubkey_policy.owner,
                )?,
            )?;
        }

        emit_cpi!(TransferHookInitialized {
            mint: ctx.accounts.mint.key(),
            pubkey_policy: ctx.accounts.pubkey_policy.key(),
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}
