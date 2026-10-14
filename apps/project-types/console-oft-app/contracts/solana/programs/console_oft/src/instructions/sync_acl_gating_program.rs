use crate::{events::AclGatingProgramSynced, map_acl_error, OFTStore};
use anchor_lang::prelude::*;
use token_manager_interface::acl;

/// Sync the cached `acl_gating_program` in OFTStore with the gate the mint's Token ACL config
/// names, or clear it when the mint has no config.
///
/// Permissionless, like `sync_transfer_hook_program`: it only copies on-chain state. Needed after
/// Token ACL is configured and whenever its gate changes (`SetGatingProgram`); until then planning
/// fails with `InvalidAclThawMetas`. The cached value is used by `lz_receive_types_info` to derive
/// the gate's thaw manifest; execution reads the gate from the config itself.
#[event_cpi]
#[derive(Accounts)]
pub struct SyncAclGatingProgram<'info> {
    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: The mint's canonical MintConfig address; unallocated when the mint has none.
    #[account(address = acl::mint_config_address(&oft_store.token_mint))]
    pub mint_config: UncheckedAccount<'info>,
}

impl SyncAclGatingProgram<'_> {
    pub fn apply(ctx: &mut Context<SyncAclGatingProgram>) -> Result<()> {
        let config = &ctx.accounts.mint_config;
        let acl_gating_program = if config.data_is_empty() {
            Pubkey::default()
        } else {
            acl::read_mint_config(config, &ctx.accounts.oft_store.token_mint)
                .map_err(map_acl_error)?
                .gating_program
        };
        // Permissionless: an unchanged value writes and emits nothing, so repeat calls add no
        // noise.
        if ctx.accounts.oft_store.acl_gating_program == acl_gating_program {
            return Ok(());
        }
        ctx.accounts.oft_store.acl_gating_program = acl_gating_program;
        emit_cpi!(AclGatingProgramSynced {
            oft_store: ctx.accounts.oft_store.key(),
            acl_gating_program
        });
        Ok(())
    }
}
