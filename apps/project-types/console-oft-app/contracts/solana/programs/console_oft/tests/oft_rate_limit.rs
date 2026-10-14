//! Rate-limit configuration, correction and views. The transfer arithmetic is unit-tested in
//! `state/rate_limit.rs`; enforcement on real sends and receives in `tests/integration`.
mod oft;

use console_oft::{
    errors::OFTError,
    events::{RateLimitAddressExemptionUpdated, RateLimitConfigUpdated, RateLimitStateUpdated},
    state::{RateLimit, RateLimitConfig, RateLimitState, RateLimitUsages},
};
use oft::helpers::*;
use solana_pubkey::Pubkey;

const ID: u128 = DST_EID as u128;
const NOW: u64 = 1_700_000_000;

fn limits(limit: u64, override_default_config: bool) -> RateLimitConfig {
    RateLimitConfig {
        override_default_config,
        outbound_limit: limit,
        inbound_limit: limit,
        outbound_window: 60,
        inbound_window: 60,
        ..RateLimitConfig::default()
    }
}

fn usage(outbound_usage: u64, inbound_usage: u64, last_updated: u64) -> RateLimitState {
    RateLimitState { outbound_usage, inbound_usage, last_updated }
}

fn seed(f: &OftFixture, id: u128, config: RateLimitConfig, state: RateLimitState) {
    f.insert(rate_limit_pda(&f.oft_store, id), program_account(RateLimit { config, state }));
}

fn limiter(f: &OftFixture, id: u128) -> RateLimit {
    read_account(&f.context, &rate_limit_pda(&f.oft_store, id))
}

#[test]
fn config_is_written_to_the_addressed_limiter() {
    let f = fixture();
    for (id, limit) in [(0, 1_000), (ID, 2_000)] {
        let result = f.ok(&set_rate_limit_config_ix(&f, f.admin, id, limits(limit, true)));
        assert_only_event(
            &result,
            RateLimitConfigUpdated {
                oft_store: to_program_pubkey(&f.oft_store),
                id,
                config: limits(limit, true),
            },
        );
        let stored: Option<RateLimit> = f.view(&rate_limits_ix(&f, id));
        assert_eq!(stored.unwrap().config.outbound_limit, limit);
    }
    assert!(f.view::<Option<RateLimit>>(&rate_limits_ix(&f, ID + 1)).is_none());
}

#[test]
fn state_can_be_corrected_but_not_into_the_future() {
    let f = fixture_at(NOW as i64);
    let corrected = usage(10_000, 8_000, NOW);
    let result = f.ok(&set_rate_limit_state_ix(&f, f.admin, 0, corrected.clone()));
    assert_only_event(
        &result,
        RateLimitStateUpdated {
            oft_store: to_program_pubkey(&f.oft_store),
            id: 0,
            state: corrected,
        },
    );
    let before = f.account(&f.default_rate_limit);
    assert_eq!(
        f.fails(&set_rate_limit_state_ix(&f, f.admin, 0, usage(0, 0, NOW + 1))),
        program_failure(OFTError::LastUpdatedInFuture)
    );
    assert_eq!(f.account(&f.default_rate_limit), before);
}

/// `get_rate_limit_usages` answers from the same state and config a transfer would use: the
/// default limiter in global mode or for id 0, otherwise the per-EID state with its own config
/// only when it overrides the default.
#[test]
fn usages_view_reads_the_state_a_transfer_would_charge() {
    // Default: 1000 limit, 400 used. Per-EID: 700 limit when overriding, 300 used.
    for (name, use_global_state, per_eid_overrides, id, outbound_available) in [
        ("global mode ignores the per-EID limiter", true, true, ID, Ok(600)),
        ("id 0 is the default limiter", false, true, 0, Ok(600)),
        ("per-EID state with its own config", false, true, ID, Ok(400)),
        ("per-EID state with the default config", false, false, ID, Ok(700)),
        ("missing per-EID state", false, true, ID + 1, Err(OFTError::RateLimitNotInitialized)),
    ] {
        let f = fixture_at(NOW as i64);
        f.update_store(|store| store.use_global_state = use_global_state);
        seed(&f, 0, limits(1_000, false), usage(400, 0, NOW));
        seed(&f, ID, limits(700, per_eid_overrides), usage(300, 0, NOW));
        let ix = get_rate_limit_usages_ix(&f, id);
        match outbound_available {
            Ok(available) => {
                let usages: RateLimitUsages = f.view(&ix);
                assert_eq!(usages.outbound_available, available, "{name}");
            },
            Err(error) => assert_eq!(f.fails(&ix), program_failure(error), "{name}"),
        }
    }
}

/// Global disable lifts the capacity cap but still reports the decayed usage on chain.
#[test]
fn globally_disabled_usages_report_decayed_usage_with_unlimited_capacity() {
    let f = fixture_at(NOW as i64);
    f.update_store(|store| store.is_globally_disabled = true);
    seed(&f, 0, limits(1_000, false), usage(800, 700, NOW - 30));
    let usages: RateLimitUsages = f.view(&get_rate_limit_usages_ix(&f, 0));
    assert_eq!(
        (usages.outbound_usage, usages.outbound_available, usages.inbound_usage),
        (300, u64::MAX, 200)
    );
}

#[test]
fn checkpoint_decays_the_selected_state_and_restamps_it() {
    // Default: 800/500 used a full window ago. Per-EID (overriding): 700/300 used half a window
    // ago. Decay over the elapsed time is limit * elapsed / window.
    for (use_global_state, id, per_eid_is_selected) in
        [(true, 0, false), (false, 0, false), (true, ID, false), (false, ID, true)]
    {
        let f = fixture_at(NOW as i64);
        f.update_store(|store| store.use_global_state = use_global_state);
        seed(&f, 0, limits(1_000, false), usage(800, 500, NOW - 60));
        seed(&f, ID, limits(1_000, true), usage(700, 300, NOW - 30));
        f.ok(&checkpoint_rate_limit_ix(&f, f.admin, id));

        let (default, per_eid) = (limiter(&f, 0).state, limiter(&f, ID).state);
        let case = format!("global={use_global_state} id={id}");
        if per_eid_is_selected {
            assert_eq!(borsh(&per_eid), borsh(&usage(200, 0, NOW)), "{case}");
            assert_eq!(borsh(&default), borsh(&usage(800, 500, NOW - 60)), "{case}");
        } else {
            assert_eq!(borsh(&default), borsh(&usage(0, 0, NOW)), "{case}");
            assert_eq!(borsh(&per_eid), borsh(&usage(700, 300, NOW - 30)), "{case}");
        }
    }
}

/// EVM parity: exemption writes that change nothing revert; revoking closes the record.
#[test]
fn address_exemption_is_granted_and_revoked_exactly_once() {
    let f = fixture();
    let user = Pubkey::new_unique();
    let exempt = |f: &OftFixture| f.view::<bool>(&is_rate_limit_address_exempt_ix(f, user));
    let set = |is_exempt| set_rate_limit_address_exemption_ix(&f, f.admin, user, is_exempt);
    let idempotent = program_failure(OFTError::ExemptionStateIdempotent);

    assert!(!exempt(&f));
    assert_eq!(f.fails(&set(false)), idempotent);

    let result = f.ok(&set(true));
    assert_only_event(
        &result,
        RateLimitAddressExemptionUpdated {
            oft_store: to_program_pubkey(&f.oft_store),
            user: to_program_pubkey(&user),
            is_exempt: true,
        },
    );
    assert!(exempt(&f));
    assert_eq!(f.fails(&set(true)), idempotent);

    f.ok(&set(false));
    assert!(f.is_closed(&rate_limit_address_exemption_pda(&f.oft_store, &user)));
    assert!(!exempt(&f));
    f.ok(&set(true));
    assert!(exempt(&f));
}

fn borsh(state: &RateLimitState) -> Vec<u8> {
    anchor_lang::prelude::borsh::to_vec(state).unwrap()
}
