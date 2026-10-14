use crate::{
    codec, combine_options, debit_view, msg_type, EnforcedOptions, FeeConfig, OAppPeer, OFTStore,
};
use anchor_lang::prelude::*;
use oapp::{
    endpoint::{
        types::{MessagingFee, QuoteParams},
        ID as ENDPOINT_ID,
    },
    endpoint_cpi,
    utils::try_load_account,
};
use oft::types::QuoteSendParams;

#[derive(Accounts)]
#[instruction(params: QuoteSendParams)]
pub struct QuoteSend<'info> {
    pub oft_store: Account<'info, OFTStore>,

    #[account(
        seeds = OAppPeer::seeds(&oft_store.key(), params.dst_eid),
        bump = peer.bump
    )]
    pub peer: Account<'info, OAppPeer>,

    /// CHECK: Enforced options PDA for this message's type (Send, or SendAndCall when a compose
    /// message is present), selected by the seeds constraint; deserialized via try_load_account
    /// in the handler.
    #[account(
        seeds = EnforcedOptions::seeds(
            &oft_store.key(),
            params.dst_eid,
            msg_type(params.compose_msg.as_deref()).into(),
        ),
        bump
    )]
    pub enforced_options: UncheckedAccount<'info>,

    /// CHECK: Per-EID fee config PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Not Option<Account<T>> — the client must always pass the correct PDA
    /// so the program (not the client) determines whether the config is initialized.
    #[account(
        seeds = FeeConfig::seeds(&oft_store.key(), params.dst_eid),
        bump
    )]
    pub fee_config: UncheckedAccount<'info>,
}

impl QuoteSend<'_> {
    pub fn apply(ctx: &Context<QuoteSend>, params: &QuoteSendParams) -> Result<MessagingFee> {
        let enforced_options = try_load_account::<EnforcedOptions>(&ctx.accounts.enforced_options)?;
        let fee_config = try_load_account(&ctx.accounts.fee_config)?;
        let (_, amount_received_ld) = debit_view(
            &ctx.accounts.oft_store,
            fee_config.as_ref(),
            params.amount_ld,
            params.min_amount_ld,
        )?;

        let amount_received_sd = ctx.accounts.oft_store.ld2sd(amount_received_ld);

        endpoint_cpi::quote(
            ENDPOINT_ID,
            ctx.remaining_accounts,
            QuoteParams {
                sender: ctx.accounts.oft_store.key(),
                dst_eid: params.dst_eid,
                receiver: ctx.accounts.peer.get_address()?,
                message: codec::msg::encode(
                    params.to,
                    amount_received_sd,
                    Pubkey::default(),
                    params.compose_msg.as_deref(),
                ),
                pay_in_lz_token: params.pay_in_lz_token,
                options: combine_options(enforced_options.as_ref(), &params.extra_options)?,
            },
        )
    }
}
