use crate::{events::TransferHookProgramSynced, get_transfer_hook_program_id, OFTStore};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

/// Sync the cached `transfer_hook_program` in OFTStore with the current value
/// from the mint's transfer hook extension.
///
/// This is permissionless — anyone can call it because it only reads the
/// on-chain mint state and writes the canonical value. Needed because the
/// mint's transfer hook authority can update the hook program externally
/// (via `spl_token_2022::TransferHookInstruction::Update`), which would
/// leave OFTStore's cached value stale.
///
/// The cached value is used by `lz_receive_types_info` (account discovery
/// step 1) to derive the `extra_account_meta_list` PDA and hook program
/// address for off-chain clients.
#[event_cpi]
#[derive(Accounts)]
pub struct SyncTransferHookProgram<'info> {
    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,

    #[account(
        address = oft_store.token_mint,
        mint::token_program = oft_store.token_program,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,
}

impl SyncTransferHookProgram<'_> {
    pub fn apply(ctx: &mut Context<SyncTransferHookProgram>) -> Result<()> {
        let transfer_hook_program =
            get_transfer_hook_program_id(&ctx.accounts.token_mint)?.unwrap_or_default();
        // Permissionless: an unchanged value writes and emits nothing, so repeat calls add no
        // noise.
        if ctx.accounts.oft_store.transfer_hook_program == transfer_hook_program {
            return Ok(());
        }
        ctx.accounts.oft_store.transfer_hook_program = transfer_hook_program;
        emit_cpi!(TransferHookProgramSynced {
            oft_store: ctx.accounts.oft_store.key(),
            transfer_hook_program
        });
        Ok(())
    }
}
