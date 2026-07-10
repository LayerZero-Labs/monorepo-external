use anchor_lang::prelude::*;

use crate::{
    constants::ONE_SIG_SEED, events::OneSigInitialized, state::OneSigState,
    types::InitOneSigParams, ID,
};

#[event_cpi]
#[derive(Accounts)]
pub struct InitOneSig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + OneSigState::INIT_SPACE,
    )]
    pub state: Account<'info, OneSigState>,
    pub system_program: Program<'info, System>,
}

impl InitOneSig<'_> {
    pub fn apply(ctx: &mut Context<InitOneSig>, params: &InitOneSigParams) -> Result<()> {
        let InitOneSigParams { one_sig_id, seed, signers, threshold, executors, executor_required } =
            params;
        ctx.accounts.state.seed = *seed;
        ctx.accounts.state.nonce = 0;
        ctx.accounts.state.one_sig_id = *one_sig_id;

        // Find the one_sig_signer PDA and bump
        let (_, bump) = Pubkey::find_program_address(
            &[ONE_SIG_SEED, &ctx.accounts.state.key().to_bytes()],
            &ID,
        );
        ctx.accounts.state.bump = bump;

        // Add signers and set threshold into the multisig
        for signer in signers {
            ctx.accounts.state.multisig.add_signer(*signer)?;
        }
        ctx.accounts.state.multisig.set_threshold(*threshold)?;

        // Add executors and set executor required
        for executor in executors {
            ctx.accounts.state.executors.add_executor(*executor)?;
        }
        ctx.accounts.state.executors.set_executor_required(*executor_required)?;

        // Emit the event
        emit_cpi!(OneSigInitialized {
            one_sig_account: ctx.accounts.state.key(),
            one_sig_id: *one_sig_id,
            seed: *seed,
            threshold: *threshold,
            signers: signers.clone(),
            executors: executors.clone(),
            executor_required: *executor_required,
        });
        Ok(())
    }
}
