use crate::{payload, ComposerStore, COMPOSER_SEED};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token_interface::Mint,
};
use console_oft::{
    state::{FeeConfig, OFTStore},
    OAppPeer,
};
use oapp::{
    endpoint::ID as ENDPOINT_ID,
    lz_compose_types_v3::{LzComposeTypesV3Accounts, LZ_COMPOSE_TYPES_VERSION},
    types::LzComposeParams,
    SEND_LIBRARY_CONFIG_SEED,
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
    /// Everything the planner reads. The second hop's destination EID comes from the payload, so
    /// the per-EID PDAs are derived here rather than configured.
    ///
    /// The mint input supplies the live hook binding, including its canonical absent witness.
    pub fn apply(
        ctx: &Context<Self>,
        params: &LzComposeParams,
    ) -> Result<(u8, LzComposeTypesV3Accounts)> {
        let store = &ctx.accounts.composer_store;
        let hop = payload::send_params(&params.message)?;
        let eid = hop.dst_eid.to_be_bytes();
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
        let pda =
            |seeds: &[&[u8]], program: &Pubkey| Pubkey::find_program_address(seeds, program).0;
        Ok((
            LZ_COMPOSE_TYPES_VERSION,
            LzComposeTypesV3Accounts {
                accounts: vec![
                    store.key(),
                    store.token_mint,
                    composer_token_account,
                    store.oft_store,
                    pda(OFTStore::oft_escrow_seeds(&store.oft_store), &console_oft::ID),
                    store.fee_deposit,
                    pda(OAppPeer::seeds(&store.oft_store, hop.dst_eid), &console_oft::ID),
                    pda(FeeConfig::seeds(&store.oft_store, hop.dst_eid), &console_oft::ID),
                    pda(&[SEND_LIBRARY_CONFIG_SEED, store.oft_store.as_ref(), &eid], &ENDPOINT_ID),
                    pda(&[SEND_LIBRARY_CONFIG_SEED, &eid], &ENDPOINT_ID),
                    manifest,
                ],
            },
        ))
    }
}
