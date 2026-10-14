//! `quote_oft`'s limit is the pre-fee amount a send could move right now.
mod oft;

use ::oft::types::QuoteOFTResult;
use console_oft::state::{RateLimit, RateLimitConfig, RoleType};
use oft::helpers::*;

fn default_limit(f: &OftFixture, config: RateLimitConfig) {
    f.insert(
        f.default_rate_limit,
        program_account(RateLimit { config, state: Default::default() }),
    );
}

fn outbound_limit(limit: u64) -> RateLimitConfig {
    RateLimitConfig { outbound_limit: limit, outbound_window: 60, ..RateLimitConfig::default() }
}

#[test]
fn paused_quote_reports_zero_capacity() {
    let f = fixture();
    f.update_store(|store| store.use_global_state = true);
    default_limit(&f, outbound_limit(1_000_000));
    f.ok(&set_default_paused_ix(&f, f.admin, RoleType::Pauser, true));
    let quote: QuoteOFTResult = f.view(&quote_oft_ix(&f, 1_000, 0));
    assert_eq!(quote.oft_limit.max_amount_ld, 0);
}

/// Capacity is post-fee (the limiter charges the received amount), so the limit is converted
/// back to the amount a sender would pass in; the receipt shows the fee on the quoted amount.
#[test]
fn quote_converts_remaining_capacity_to_a_pre_fee_amount_and_itemizes_the_fee() {
    let f = fixture();
    f.update_store(|store| store.use_global_state = true);
    default_limit(&f, outbound_limit(1_000_000));
    f.ok(&set_fee_bps_ix(&f, f.admin, DST_EID.into(), Some(50)));

    let quote: QuoteOFTResult = f.view(&quote_oft_ix(&f, 1_000, 0));
    assert_eq!(quote.oft_limit.max_amount_ld, 1_005_025);
    assert_eq!(
        (quote.oft_receipt.amount_sent_ld, quote.oft_receipt.amount_received_ld),
        (1_000, 995)
    );
    assert_eq!(quote.oft_fee_details.len(), 1);
    assert_eq!(quote.oft_fee_details[0].fee_amount_ld, 5);
}

/// A send that would neither charge outbound nor refund inbound needs no per-EID limiter, and
/// is unbounded; the quote must agree rather than demand the missing PDA.
#[test]
fn quote_is_unbounded_when_the_send_would_not_touch_rate_state() {
    let f = fixture();
    default_limit(
        &f,
        RateLimitConfig {
            outbound_enabled: false,
            net_accounting_enabled: false,
            ..outbound_limit(1_000_000)
        },
    );
    let quote: QuoteOFTResult = f.view(&quote_oft_ix(&f, 1_000, 0));
    assert_eq!(quote.oft_limit.max_amount_ld, u64::MAX);
}
