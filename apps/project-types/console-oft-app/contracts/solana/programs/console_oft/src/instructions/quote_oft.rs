use super::{fee_config, pause};
use crate::{
    debit_view, state, FeeConfig, OFTStore, PauseConfig, RateLimit, DEFAULT_RATE_LIMIT_ID,
};
use anchor_lang::prelude::*;
use oapp::utils::try_load_account;
use oft::types::{OFTFeeDetail, OFTLimit, OFTReceipt, QuoteOFTParams, QuoteOFTResult};

#[derive(Accounts)]
#[instruction(params: QuoteOFTParams)]
pub struct QuoteOFT<'info> {
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: Per-EID pause config PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Not Option<Account<T>> — the client must always pass the correct PDA
    /// so the program (not the client) determines whether the config is initialized.
    #[account(
        seeds = PauseConfig::seeds(&oft_store.key(), params.dst_eid),
        bump
    )]
    pub pause_config: UncheckedAccount<'info>,

    /// CHECK: Per-EID fee config PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Not Option<Account<T>> — the client must always pass the correct PDA
    /// so the program (not the client) determines whether the config is initialized.
    #[account(
        seeds = FeeConfig::seeds(&oft_store.key(), params.dst_eid),
        bump
    )]
    pub fee_config: UncheckedAccount<'info>,

    #[account(
        seeds = RateLimit::seeds(&oft_store.key(), DEFAULT_RATE_LIMIT_ID),
        bump
    )]
    pub default_rate_limit: Account<'info, RateLimit>,

    /// CHECK: Per-EID rate limiter PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Not Option<Account<T>> — the client must always pass the correct PDA
    /// so the program (not the client) determines whether the config is initialized.
    #[account(
        seeds = RateLimit::seeds(&oft_store.key(), params.dst_eid),
        bump
    )]
    pub rate_limit: UncheckedAccount<'info>,
}

impl QuoteOFT<'_> {
    pub fn apply(ctx: &Context<QuoteOFT>, params: &QuoteOFTParams) -> Result<QuoteOFTResult> {
        let pause_config = try_load_account(&ctx.accounts.pause_config)?;
        let fee_config = try_load_account(&ctx.accounts.fee_config)?;
        let rate_limit = try_load_account(&ctx.accounts.rate_limit)?;

        let mut max_amount_ld =
            if pause::is_paused(ctx.accounts.oft_store.default_paused, pause_config.as_ref()) {
                0
            } else {
                state::get_outbound_available_for_quote(
                    &ctx.accounts.oft_store,
                    &ctx.accounts.default_rate_limit,
                    rate_limit.as_ref(),
                )?
            };

        // EVM parity: convert post-fee capacity back to pre-fee send amount using only
        // getAmountBeforeFee. The send path removes dust after applying the fee, so this can
        // conservatively under-report the true max at dust boundaries. It never over-reports
        // capacity or bypasses the rate-limit ceiling.
        if max_amount_ld != 0 && max_amount_ld != u64::MAX {
            max_amount_ld = fee_config::get_amount_before_fee(
                ctx.accounts.oft_store.default_fee_bps,
                fee_config.as_ref(),
                max_amount_ld,
            );
        }

        let oft_limit = OFTLimit { min_amount_ld: 0, max_amount_ld };

        let (amount_sent_ld, amount_received_ld) = debit_view(
            &ctx.accounts.oft_store,
            fee_config.as_ref(),
            params.amount_ld,
            params.min_amount_ld,
        )?;

        let oft_fee_details = if amount_sent_ld > amount_received_ld {
            vec![OFTFeeDetail {
                fee_amount_ld: (amount_sent_ld - amount_received_ld) as i128,
                description: "Fee".to_string(),
            }]
        } else {
            vec![]
        };
        let oft_receipt = OFTReceipt { amount_sent_ld, amount_received_ld };
        Ok(QuoteOFTResult { oft_limit, oft_fee_details, oft_receipt })
    }
}
