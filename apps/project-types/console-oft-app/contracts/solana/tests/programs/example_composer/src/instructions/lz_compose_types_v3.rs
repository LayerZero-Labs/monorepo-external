use crate::ComposerStore;
use anchor_lang::prelude::*;
use oapp::{
    common::{AccountMetaRef, EXECUTION_CONTEXT_VERSION_1},
    endpoint::ID as ENDPOINT_ID,
    lz_compose_types_v3::{
        get_accounts_for_clear_compose, ComposeInstruction, LzComposeTypesV3Result,
    },
    types::LzComposeParams,
};

#[derive(Accounts)]
#[instruction(params: LzComposeParams)]
pub struct LzComposeTypesV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Ephemeral scratch the caller creates and signs for; `oapp::lz_plan` validates it.
    #[account(mut)]
    pub plan_out: Signer<'info>,
    #[account(constraint = composer_store.key() == params.to)]
    pub composer_store: Account<'info, ComposerStore>,
}

impl LzComposeTypesV3<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &LzComposeParams) -> Result<u32> {
        let mut accounts = vec![AccountMetaRef {
            pubkey: ctx.accounts.composer_store.key().into(),
            is_writable: true,
        }];

        accounts.extend(get_accounts_for_clear_compose(
            ENDPOINT_ID,
            &params.from,
            &params.to,
            &params.guid,
            params.index,
            &params.message,
        ));

        let plan = LzComposeTypesV3Result {
            context_version: EXECUTION_CONTEXT_VERSION_1,
            instructions: vec![ComposeInstruction::LzCompose { accounts }],
        };
        oapp::lz_plan::write(ctx.program_id, &ctx.accounts.plan_out, &plan)
    }
}
