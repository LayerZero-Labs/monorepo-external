use anchor_lang::prelude::*;

use crate::{
    constants::ONE_SIG_SEED,
    events::ConfigSet,
    state::OneSigState,
    types::{Address, Hash},
};

// A single config change applied by set_config (one variant per call).
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub enum SetConfigParams {
    // Add a secp256k1 signer address to the multisig.
    AddSigner(Address),
    // Remove a signer address from the multisig.
    RemoveSigner(Address),
    // Set the number of signer approvals required.
    SetThreshold(u8),
    // Rotate the seed; invalidates all existing signed roots.
    SetSeed(Hash),
    // Allowlist a Solana pubkey as an executor.
    AddExecutor(Pubkey),
    // Remove a pubkey from the executor allowlist.
    RemoveExecutor(Pubkey),
    // Toggle whether execution requires an allowlisted/authorized executor.
    SetExecutorRequired(bool),
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetConfig<'info> {
    #[account(seeds = [ONE_SIG_SEED, state.key().as_ref()], bump = state.bump)]
    pub one_sig_signer: Signer<'info>,

    #[account(mut)]
    pub state: Account<'info, OneSigState>,
}

impl SetConfig<'_> {
    pub fn apply(ctx: Context<SetConfig>, params: SetConfigParams) -> Result<()> {
        match &params {
            SetConfigParams::AddSigner(signer) => {
                ctx.accounts.state.multisig.add_signer(*signer)?;
            },
            SetConfigParams::RemoveSigner(signer) => {
                ctx.accounts.state.multisig.remove_signer(*signer)?;
            },
            SetConfigParams::SetThreshold(threshold) => {
                ctx.accounts.state.multisig.set_threshold(*threshold)?;
            },
            SetConfigParams::SetSeed(seed) => {
                ctx.accounts.state.seed = *seed;
            },
            SetConfigParams::AddExecutor(executor) => {
                ctx.accounts.state.executors.add_executor(*executor)?;
            },
            SetConfigParams::RemoveExecutor(executor) => {
                ctx.accounts.state.executors.remove_executor(*executor)?;
            },
            SetConfigParams::SetExecutorRequired(executor_required) => {
                ctx.accounts.state.executors.set_executor_required(*executor_required)?;
            },
        }
        emit_cpi!(ConfigSet { one_sig_account: ctx.accounts.state.key(), params });
        Ok(())
    }
}
