use crate::{ComposerStore, COMPOSER_SEED};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token_interface::Mint,
};
use oapp::{
    lz_compose_types_v3::{LzComposeTypesV3Accounts, LZ_COMPOSE_TYPES_VERSION},
    types::LzComposeParams,
};

#[derive(Accounts)]
#[instruction(params: LzComposeParams)]
pub struct LzComposeTypesInfo<'info> {
    #[account(seeds = [COMPOSER_SEED], bump = composer_store.bump)]
    pub composer_store: Account<'info, ComposerStore>,

    /// CHECK: PDA for lz_compose_types_v3 lookup
    #[account(seeds = [oapp::LZ_COMPOSE_TYPES_SEED, &composer_store.key().to_bytes()], bump)]
    pub lz_compose_types_accounts: UncheckedAccount<'info>,

    #[account(address = composer_store.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,
}

impl LzComposeTypesInfo<'_> {
    /// Names every fixed planner input, including the live hook's canonical manifest witness.
    /// The recipient address comes from the payload; its mint/owner seed prefix can be synthesized.
    pub fn apply(
        ctx: &Context<Self>,
        _params: &LzComposeParams,
    ) -> Result<(u8, LzComposeTypesV3Accounts)> {
        let store = &ctx.accounts.composer_store;
        let composer_token_account = get_associated_token_address_with_program_id(
            &store.key(),
            &store.token_mint,
            ctx.accounts.token_mint.to_account_info().owner,
        );
        let manifest = console_oft::get_transfer_hook_program_id(&ctx.accounts.token_mint)?
            .map(|hook| {
                spl_transfer_hook_interface::get_extra_account_metas_address(
                    &store.token_mint,
                    &hook,
                )
            })
            .unwrap_or(crate::ID);
        Ok((
            LZ_COMPOSE_TYPES_VERSION,
            LzComposeTypesV3Accounts {
                accounts: vec![
                    store.key(),
                    store.token_mint,
                    composer_token_account,
                    manifest,
                    token_manager_interface::acl::thaw_metas_address(
                        &store.token_mint,
                        &token_manager_interface::ID,
                    ),
                ],
            },
        ))
    }
}
