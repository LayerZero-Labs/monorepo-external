use crate::{ComposerStore, COMPOSER_SEED};
use anchor_lang::prelude::*;
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
}

impl LzComposeTypesInfo<'_> {
    pub fn apply(
        ctx: &Context<Self>,
        _params: &LzComposeParams,
    ) -> Result<(u8, LzComposeTypesV3Accounts)> {
        Ok((
            LZ_COMPOSE_TYPES_VERSION,
            LzComposeTypesV3Accounts { accounts: vec![ctx.accounts.composer_store.key()] },
        ))
    }
}
