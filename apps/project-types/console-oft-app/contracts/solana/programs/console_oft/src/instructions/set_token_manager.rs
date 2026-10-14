use crate::{events::TokenManagerSet, OFTStore, RoleMember, RoleType};
use anchor_lang::prelude::*;

/// Selects, replaces, or clears the TokenManager root whose PermissionedBurn approval BurnMint
/// sends request. `send` invokes the program that owns the root, so a root under a new
/// TokenManager program is selected the same way. That program gets only the escrow's signature,
/// approved for the send's amount, so the root must grant its Burner role to `oft_escrow`. Keeping
/// it the root that holds the mint's PB authority is the admin's job; Token-2022 rejects the burn
/// otherwise.
#[rbac::only_role(role = RoleType::DefaultAdmin, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct SetTokenManager<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: The root to accept, or none.
    pub token_manager: Option<UncheckedAccount<'info>>,
}

impl SetTokenManager<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let token_manager = ctx.accounts.token_manager.as_ref().map(|root| root.key());
        ctx.accounts.oft_store.token_manager = token_manager;
        emit_cpi!(TokenManagerSet { oft_store: ctx.accounts.oft_store.key(), token_manager });
        Ok(())
    }
}
