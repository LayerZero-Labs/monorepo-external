//! LayerZero rate limiter tests

use core::cmp::min;
use core::num::traits::{SaturatingAdd, SaturatingSub};
use layerzero::oapps::common::rate_limiter::errors::err_rate_limit_exceeded;
use layerzero::oapps::common::rate_limiter::events::{RateLimitsChanged, RateLimitsReset};
use layerzero::oapps::common::rate_limiter::interface::{
    IRateLimiterDispatcher, IRateLimiterDispatcherTrait,
};
use layerzero::oapps::common::rate_limiter::rate_limiter::RateLimiterComponent;
use layerzero::oapps::common::rate_limiter::structs::{
    RateLimit, RateLimitConfig, RateLimitDirection, RateLimitEnabled, SendableAmount,
};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait,
    cheat_block_timestamp, declare, spy_events,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::assert_panic_with_error;
use crate::constants::assert_eq;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::mocks::rate_limiter::interface::{
    IMockRateLimiterDispatcher, IMockRateLimiterDispatcherTrait, IMockRateLimiterSafeDispatcher,
    IMockRateLimiterSafeDispatcherTrait,
};

#[derive(Drop)]
struct RateLimiterHelper {
    address: ContractAddress,
    rate_limiter: IRateLimiterDispatcher,
    mock_rate_limiter: IMockRateLimiterDispatcher,
    safe_mock_rate_limiter: IMockRateLimiterSafeDispatcher,
}

fn deploy_mock_rate_limiter_with_enabled(enabled: RateLimitEnabled) -> RateLimiterHelper {
    let contract = declare("MockRateLimiter").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap_syscall();
    let mock_rate_limiter = IMockRateLimiterDispatcher { contract_address: address };
    mock_rate_limiter.set_rate_limit_enabled(enabled);

    RateLimiterHelper {
        address,
        rate_limiter: IRateLimiterDispatcher { contract_address: address },
        mock_rate_limiter,
        safe_mock_rate_limiter: IMockRateLimiterSafeDispatcher { contract_address: address },
    }
}

fn deploy_mock_rate_limiter() -> RateLimiterHelper {
    deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: false },
    )
}


#[test]
fn test_deploy() {
    deploy_mock_rate_limiter();
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_rate_limit(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter();
    let mut spy = spy_events();
    let configs = array![RateLimitConfig { dst_eid, limit, window }];

    limiter.mock_rate_limiter.set_rate_limits(configs.clone());

    spy
        .assert_emitted(
            @array![
                (
                    limiter.address,
                    RateLimiterComponent::Event::RateLimitsChanged(
                        RateLimitsChanged { configs, direction: RateLimitDirection::Outbound },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_rate_limits(
    dst_eid_1: u32, limit_1: u128, window_1: u64, dst_eid_2: u32, limit_2: u128, window_2: u64,
) {
    if dst_eid_1 == dst_eid_2 {
        return;
    }

    let limiter = deploy_mock_rate_limiter();
    let mut spy = spy_events();
    let configs = array![
        RateLimitConfig { dst_eid: dst_eid_1, limit: limit_1, window: window_1 },
        RateLimitConfig { dst_eid: dst_eid_2, limit: limit_2, window: window_2 },
    ];

    limiter.mock_rate_limiter.set_rate_limits(configs.clone());

    spy
        .assert_emitted(
            @array![
                (
                    limiter.address,
                    RateLimiterComponent::Event::RateLimitsChanged(
                        RateLimitsChanged { configs, direction: RateLimitDirection::Outbound },
                    ),
                ),
            ],
        );
}


#[test]
#[fuzzer(runs: 10)]
fn test_set_rate_limit_with_state_checkpoint(
    dst_eid: u32,
    limit_1: u128,
    window_1: u16,
    limit_2: u128,
    window_2: u16,
    amount: u256,
    duration: u16,
) {
    let limit_1 = limit_1.into();
    let window_1 = window_1.into();
    let limit_2 = limit_2.into();
    let window_2 = window_2.into();
    let duration = duration.into() + 1;
    let limiter = deploy_mock_rate_limiter();

    limiter
        .mock_rate_limiter
        .set_rate_limits(array![RateLimitConfig { dst_eid, limit: limit_1, window: window_1 }]);
    // Hit the rate limit.
    limiter.mock_rate_limiter.outflow(dst_eid, limit_1.into());

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: limit_1, last_updated: 0, limit: limit_1, window: window_1 },
    );

    cheat_block_timestamp(limiter.address, duration, CheatSpan::Indefinite);
    limiter
        .mock_rate_limiter
        .set_rate_limits(array![RateLimitConfig { dst_eid, limit: limit_2, window: window_2 }]);
    let limit_1: u256 = limit_1.into();
    let amount_in_flight: u256 = limit_1
        .saturating_sub(limit_1.into() * duration.into() / window_1.into())
        .try_into()
        .unwrap();

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit {
            amount_in_flight: amount_in_flight.try_into().unwrap(),
            last_updated: duration,
            limit: limit_2,
            window: window_2,
        },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_rate_limit(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter();

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_rate_limits(
    dst_eid_1: u32, limit_1: u128, window_1: u64, dst_eid_2: u32, limit_2: u128, window_2: u64,
) {
    if dst_eid_1 == dst_eid_2 {
        return;
    }

    let limiter = deploy_mock_rate_limiter();

    limiter
        .mock_rate_limiter
        .set_rate_limits(
            array![
                RateLimitConfig { dst_eid: dst_eid_1, limit: limit_1, window: window_1 },
                RateLimitConfig { dst_eid: dst_eid_2, limit: limit_2, window: window_2 },
            ],
        );

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid_1),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit: limit_1, window: window_1 },
    );
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid_2),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit: limit_2, window: window_2 },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_sendable_amount(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter();

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: 0, sendable_amount: limit.into() },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_sendable_amount_before_full_window(
    dst_eid: u32, limit: u128, window: u16, amount: u256, duration: u16,
) {
    let limit = limit.into();
    let window = window.saturating_add(1);
    let duration = duration % window; // in [0, window)
    let limiter = deploy_mock_rate_limiter();

    limiter
        .mock_rate_limiter
        .set_rate_limits(array![RateLimitConfig { dst_eid, limit, window: window.into() }]);
    // Hit the rate limit.
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: limit.into(), sendable_amount: 0 },
    );

    cheat_block_timestamp(limiter.address, duration.into(), CheatSpan::Indefinite);
    let SendableAmount {
        amount_in_flight, sendable_amount,
    } = limiter.rate_limiter.get_sendable_amount(dst_eid);

    assert_eq(sendable_amount, limit.into() * duration.into() / window.into());
    assert_eq(amount_in_flight, limit.into() - sendable_amount.into());
}

// Although this case is covered by `test_get_sendable_amount_after_duration` already, we add it so
// that it is tested on every run of the test suite.
#[test]
#[fuzzer(runs: 10)]
fn test_get_sendable_amount_after_full_window(
    dst_eid: u32, limit: u128, window: u16, amount: u256, delta: u8,
) {
    let limit = limit.into();
    let delta = delta.into();
    let limiter = deploy_mock_rate_limiter();

    limiter
        .mock_rate_limiter
        .set_rate_limits(array![RateLimitConfig { dst_eid, limit, window: window.into() }]);
    // Hit the rate limit.
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: limit.into(), sendable_amount: 0 },
    );

    // We reach exactly to or go over the full window.
    cheat_block_timestamp(limiter.address, window.into() + delta, CheatSpan::Indefinite);
    let SendableAmount {
        amount_in_flight, sendable_amount,
    } = limiter.rate_limiter.get_sendable_amount(dst_eid);

    assert_eq(sendable_amount, limit.into());
    assert_eq(amount_in_flight, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_sendable_amount_without_configuration(dst_eid: u32) {
    let limiter = deploy_mock_rate_limiter();

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: 0, sendable_amount: 0 },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_by_zero(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter();

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter.mock_rate_limiter.outflow(dst_eid, 0);

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit, window },
    );
    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: 0, sendable_amount: limit.into() },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow(dst_eid: u32, limit: u128, window: u64, amount: u128) {
    let limiter = deploy_mock_rate_limiter();

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    let amount = min(amount, limit.into());
    limiter.mock_rate_limiter.outflow(dst_eid, amount.into());

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: amount.into(), last_updated: 0, limit, window },
    );
    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount {
            amount_in_flight: amount.into(), sendable_amount: limit.into() - amount.into(),
        },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_before_full_window(
    dst_eid: u32, limit: u128, window: u16, amount: u256, duration: u16,
) {
    let limit = limit.into();
    let window = window.saturating_add(1);
    let duration = (duration % window).into();
    let window = window.into();
    let limiter = deploy_mock_rate_limiter();

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    // Hit the rate limit.
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: limit.into(), sendable_amount: 0 },
    );

    cheat_block_timestamp(limiter.address, duration, CheatSpan::Indefinite);
    let sendable_amount = limiter.rate_limiter.get_sendable_amount(dst_eid);
    limiter.mock_rate_limiter.outflow(dst_eid, sendable_amount.sendable_amount);

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: limit.into(), sendable_amount: 0 },
    );
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: limit, last_updated: duration, limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_after_full_window(dst_eid: u32, limit: u128, window: u16, amount: u256) {
    let limit = limit.into();
    let window = window.into();
    let limiter = deploy_mock_rate_limiter();

    limiter
        .mock_rate_limiter
        .set_rate_limits(array![RateLimitConfig { dst_eid, limit, window: window.into() }]);
    // Hit the rate limit.
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: limit.into(), sendable_amount: 0 },
    );

    cheat_block_timestamp(limiter.address, window, CheatSpan::Indefinite);
    // Hit the rate limit again.
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());

    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: limit.into(), sendable_amount: 0 },
    );
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit {
            amount_in_flight: limit, last_updated: window.into(), limit, window: window.into(),
        },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_with_exceeded_limit(dst_eid: u32, limit: u128, window: u64, amount: u256) {
    let limiter = deploy_mock_rate_limiter();
    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    let result = limiter.safe_mock_rate_limiter.outflow(dst_eid, limit.into() + 1);
    assert_panic_with_error(result, err_rate_limit_exceeded());
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_by_zero_without_configuration(dst_eid: u32) {
    let limiter = deploy_mock_rate_limiter();
    limiter.mock_rate_limiter.outflow(dst_eid, 0);

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit: 0, window: 0 },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_by_one_without_configuration(dst_eid: u32) {
    let limiter = deploy_mock_rate_limiter();
    let result = limiter.safe_mock_rate_limiter.outflow(dst_eid, 1);
    assert_panic_with_error(result, err_rate_limit_exceeded());
}

#[test]
#[fuzzer(runs: 10)]
fn test_inflow(
    dst_eid: u32, limit: u128, window: u16, out_amount: u128, in_amount: u128, duration: u16,
) {
    let window: u64 = window.saturating_add(1).into();
    let out_amount = min(out_amount, limit.into());
    let limiter = deploy_mock_rate_limiter();

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter.mock_rate_limiter.outflow(dst_eid, out_amount.into());
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, out_amount);

    let duration: u64 = (duration % window.try_into().unwrap()).into();
    cheat_block_timestamp(limiter.address, duration, CheatSpan::Indefinite);
    limiter.mock_rate_limiter.inflow(dst_eid, in_amount.into());

    // When processing inflow, the opposite direction (outbound) amount_in_flight is first decayed
    // based on time elapsed, then the inflow amount is subtracted
    let decayed_out_amount: u256 = (out_amount)
        .into()
        .saturating_sub(limit.into() * duration.into() / window.into());
    let expected_in_flight = decayed_out_amount.saturating_sub(in_amount.into());

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit {
            amount_in_flight: expected_in_flight.try_into().unwrap(),
            last_updated: duration,
            limit,
            window,
        },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_inflow_below_zero(dst_eid: u32, limit: u128, window: u16, amount: u128, duration: u16) {
    let window = window.into();
    let amount = min(amount, limit);
    let limiter = deploy_mock_rate_limiter();

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter.mock_rate_limiter.outflow(dst_eid, amount.into());
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, amount);

    // Inflow back the same amount after a while.
    cheat_block_timestamp(limiter.address, duration.into(), CheatSpan::Indefinite);
    limiter.mock_rate_limiter.inflow(dst_eid, amount.into());

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: duration.into(), limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_inflow_without_configuration(dst_eid: u32, amount: u256) {
    let limiter = deploy_mock_rate_limiter();
    limiter.mock_rate_limiter.inflow(dst_eid, amount);
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit: 0, window: 0 },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_rate_limit(dst_eid: u32, limit: u128, window: u64, amount: u128, duration: u16) {
    let amount = min(amount, limit);
    let limiter = deploy_mock_rate_limiter();
    let mut spy = spy_events();

    // Setup rate limit and outflow some amount
    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter.mock_rate_limiter.outflow(dst_eid, amount.into());

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: amount, last_updated: 0, limit, window },
    );

    // Wait some time
    cheat_block_timestamp(limiter.address, duration.into(), CheatSpan::Indefinite);

    // Reset the rate limit
    let eids = array![dst_eid];
    limiter.mock_rate_limiter.reset_rate_limits(eids.clone());

    // Verify the rate limit was reset (amount_in_flight = 0, last_updated = current timestamp)
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: duration.into(), limit, window },
    );

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    limiter.address,
                    RateLimiterComponent::Event::RateLimitsReset(RateLimitsReset { eids }),
                ),
            ],
        );

    // Verify we can now send the full limit again
    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: 0, sendable_amount: limit.into() },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_multiple_rate_limits(
    dst_eid_1: u32,
    limit_1: u128,
    window_1: u64,
    amount_1: u128,
    dst_eid_2: u32,
    limit_2: u128,
    window_2: u64,
    amount_2: u128,
    duration: u16,
) {
    if dst_eid_1 == dst_eid_2 {
        return;
    }

    let amount_1 = min(amount_1, limit_1);
    let amount_2 = min(amount_2, limit_2);
    let limiter = deploy_mock_rate_limiter();
    let mut spy = spy_events();

    // Setup rate limits and outflow for both
    limiter
        .mock_rate_limiter
        .set_rate_limits(
            array![
                RateLimitConfig { dst_eid: dst_eid_1, limit: limit_1, window: window_1 },
                RateLimitConfig { dst_eid: dst_eid_2, limit: limit_2, window: window_2 },
            ],
        );
    limiter.mock_rate_limiter.outflow(dst_eid_1, amount_1.into());
    limiter.mock_rate_limiter.outflow(dst_eid_2, amount_2.into());

    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid_1).amount_in_flight, amount_1);
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid_2).amount_in_flight, amount_2);

    // Wait some time
    cheat_block_timestamp(limiter.address, duration.into(), CheatSpan::Indefinite);

    // Reset both rate limits
    let eids = array![dst_eid_1, dst_eid_2];
    limiter.mock_rate_limiter.reset_rate_limits(eids.clone());

    // Verify both rate limits were reset
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid_1),
        RateLimit {
            amount_in_flight: 0, last_updated: duration.into(), limit: limit_1, window: window_1,
        },
    );
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid_2),
        RateLimit {
            amount_in_flight: 0, last_updated: duration.into(), limit: limit_2, window: window_2,
        },
    );

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    limiter.address,
                    RateLimiterComponent::Event::RateLimitsReset(RateLimitsReset { eids }),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_rate_limit_at_max(dst_eid: u32, limit: u128, window: u64, duration: u16) {
    let limiter = deploy_mock_rate_limiter();

    // Setup rate limit and hit the max
    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());

    // Verify we can't send more
    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: limit.into(), sendable_amount: 0 },
    );

    // Wait some time
    cheat_block_timestamp(limiter.address, duration.into(), CheatSpan::Indefinite);

    // Reset the rate limit
    limiter.mock_rate_limiter.reset_rate_limits(array![dst_eid]);

    // Verify we can now send the full limit again immediately
    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: 0, sendable_amount: limit.into() },
    );

    // Verify we can actually use it
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: limit, last_updated: duration.into(), limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_rate_limit_without_configuration(dst_eid: u32) {
    let limiter = deploy_mock_rate_limiter();
    let mut spy = spy_events();

    // Reset without any configuration
    let eids = array![dst_eid];
    limiter.mock_rate_limiter.reset_rate_limits(eids.clone());

    // Verify the rate limit remains at default but with updated timestamp
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit: 0, window: 0 },
    );

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    limiter.address,
                    RateLimiterComponent::Event::RateLimitsReset(RateLimitsReset { eids }),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_after_partial_decay(dst_eid: u32, limit: u128, window: u16, duration: u16) {
    let window = window.saturating_add(1);
    let duration = (duration % window).into();
    let window = window.into();
    let limiter = deploy_mock_rate_limiter();

    // Setup rate limit and hit the max
    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into());

    // Wait some time for partial decay
    cheat_block_timestamp(limiter.address, duration, CheatSpan::Indefinite);

    // Check that some capacity has been restored
    let before_reset = limiter.rate_limiter.get_sendable_amount(dst_eid);
    let expected_sendable = limit.into() * duration.into() / window.into();
    assert_eq(before_reset.sendable_amount, expected_sendable);

    // Reset the rate limit
    limiter.mock_rate_limiter.reset_rate_limits(array![dst_eid]);

    // After reset, should have full capacity regardless of partial decay
    assert_eq(
        limiter.rate_limiter.get_sendable_amount(dst_eid),
        SendableAmount { amount_in_flight: 0, sendable_amount: limit.into() },
    );
}

// ============================================================================
// Tests for different RateLimitEnabled configurations
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_with_both_disabled(dst_eid: u32, limit: u128, window: u64, amount: u256) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: false },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Should be able to outflow any amount when outbound is disabled, even beyond the limit
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into() + 1000);

    // Amount in flight should not be tracked when disabled
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_inflow_with_both_disabled(dst_eid: u32, limit: u128, window: u64, amount: u256) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: false },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Inflow should work without tracking when inbound is disabled
    limiter.mock_rate_limiter.inflow(dst_eid, amount);

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_with_only_inbound_enabled(dst_eid: u32, limit: u128, window: u64, amount: u256) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Outflow should not be rate limited when outbound is disabled
    limiter.mock_rate_limiter.outflow(dst_eid, limit.into() + 1000);

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_inflow_with_only_inbound_enabled(dst_eid: u32, limit: u128, window: u64, amount: u128) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
    );

    // Set inbound rate limits since inbound is enabled
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(array![RateLimitConfig { dst_eid, limit, window }]);

    // Inflow should be limited by the inbound rate limit
    let amount = min(amount, limit.into());
    limiter.mock_rate_limiter.inflow(dst_eid, amount.into());

    // When only inbound is enabled, inflow should track amount_in_flight in inbound storage
    assert_eq(limiter.rate_limiter.get_receivable_amount(dst_eid).amount_in_flight, amount.into());
}

#[test]
#[fuzzer(runs: 10)]
fn test_inflow_exceeds_limit_with_only_inbound_enabled(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
    );

    // Set inbound rate limits since inbound is enabled
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(array![RateLimitConfig { dst_eid, limit, window }]);

    // Try to inflow more than the limit when inbound is enabled
    let result = limiter.safe_mock_rate_limiter.inflow(dst_eid, limit.into() + 1);
    assert_panic_with_error(result, err_rate_limit_exceeded());
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_with_both_enabled(dst_eid: u32, limit: u128, window: u64, amount: u128) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    let amount = min(amount, limit.into());
    limiter.mock_rate_limiter.outflow(dst_eid, amount.into());

    // Outbound should track when enabled
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, amount);
}

#[test]
#[fuzzer(runs: 10)]
fn test_inflow_with_both_enabled(dst_eid: u32, limit: u128, window: u64, amount: u128) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
    );

    // Set both outbound and inbound rate limits since both are enabled
    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(array![RateLimitConfig { dst_eid, limit, window }]);

    // First outflow (this will be tracked in outbound)
    let amount = min(amount, limit.into());
    limiter.mock_rate_limiter.outflow(dst_eid, amount.into());

    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, amount);

    // Inflow should reduce the outbound amount_in_flight (opposite direction)
    limiter.mock_rate_limiter.inflow(dst_eid, amount.into());

    // Outbound amount_in_flight should be reduced
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_exceeds_limit_with_both_enabled(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Try to outflow more than the limit
    let result = limiter.safe_mock_rate_limiter.outflow(dst_eid, limit.into() + 1);
    assert_panic_with_error(result, err_rate_limit_exceeded());
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_receivable_amount_with_inbound_disabled(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: false },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // When inbound is disabled, receivable_amount should be 0
    let receivable = limiter.rate_limiter.get_receivable_amount(dst_eid);
    assert_eq(receivable.amount_in_flight, 0);
    assert_eq(receivable.receivable_amount, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_receivable_amount_with_inbound_enabled(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
    );

    // Set inbound rate limits since we're checking receivable amount
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(array![RateLimitConfig { dst_eid, limit, window }]);

    // When inbound is enabled and configured, receivable_amount should be equal to limit
    let receivable = limiter.rate_limiter.get_receivable_amount(dst_eid);
    assert_eq(receivable.amount_in_flight, 0);
    assert_eq(receivable.receivable_amount, limit.into());
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_sendable_amount_with_outbound_disabled(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Even when outbound enforcement is disabled, get_sendable_amount still returns the configured
    // limit The enabled flag only controls whether outflow enforces the limit, not what
    // get_sendable_amount returns
    let sendable = limiter.rate_limiter.get_sendable_amount(dst_eid);
    assert_eq(sendable.amount_in_flight, 0);
    assert_eq(sendable.sendable_amount, limit.into());
}

#[test]
#[fuzzer(runs: 10)]
fn test_outflow_inflow_cycle_with_both_enabled(
    dst_eid: u32, limit: u128, window: u16, amount_1: u128, amount_2: u128, duration: u16,
) {
    let window: u64 = window.saturating_add(1).into();
    let amount_1 = min(amount_1, limit.into());
    let amount_2 = min(amount_2, limit.into());

    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
    );

    // Set both outbound and inbound rate limits
    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(array![RateLimitConfig { dst_eid, limit, window }]);

    // First outflow
    limiter.mock_rate_limiter.outflow(dst_eid, amount_1.into());
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, amount_1);

    // Wait some time (ensure duration is less than window to avoid complete decay)
    let duration: u64 = (duration % window.try_into().unwrap()).into();
    cheat_block_timestamp(limiter.address, duration, CheatSpan::Indefinite);

    // Inflow to reduce outbound amount_in_flight
    limiter.mock_rate_limiter.inflow(dst_eid, amount_2.into());

    // When processing inflow, the opposite direction (outbound) amount_in_flight is first decayed
    // based on time elapsed, then the inflow amount is subtracted
    let decayed_amount_1: u256 = (amount_1)
        .into()
        .saturating_sub(limit.into() * duration.into() / window.into());
    let expected_in_flight = decayed_amount_1.saturating_sub(amount_2.into());

    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight,
        expected_in_flight.try_into().unwrap(),
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_rate_limit_with_both_disabled(dst_eid: u32, limit: u128, window: u64) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: false },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Reset the rate limit
    limiter.mock_rate_limiter.reset_rate_limits(array![dst_eid]);

    // Verify the rate limit was reset
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_rate_limit_with_only_inbound_enabled(
    dst_eid: u32, limit: u128, window: u64, amount: u128,
) {
    let amount = min(amount, limit);
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
    );

    // Set inbound rate limits
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(array![RateLimitConfig { dst_eid, limit, window }]);

    // Inflow some amount (will be tracked when inbound is enabled)
    limiter.mock_rate_limiter.inflow(dst_eid, amount.into());
    assert_eq(limiter.rate_limiter.get_receivable_amount(dst_eid).amount_in_flight, amount.into());

    // Reset the rate limit (resets both outbound and inbound)
    limiter.mock_rate_limiter.reset_rate_limits(array![dst_eid]);

    // Verify the inbound rate limit was reset
    let receivable = limiter.rate_limiter.get_receivable_amount(dst_eid);
    assert_eq(receivable.amount_in_flight, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_reset_rate_limit_with_both_enabled_after_outflow(
    dst_eid: u32, limit: u128, window: u64, amount: u128,
) {
    let amount = min(amount, limit);
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Outflow when both are enabled
    limiter.mock_rate_limiter.outflow(dst_eid, amount.into());
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, amount);

    // Reset the rate limit
    limiter.mock_rate_limiter.reset_rate_limits(array![dst_eid]);

    // Verify the rate limit was reset
    assert_eq(
        limiter.rate_limiter.get_outbound_rate_limit(dst_eid),
        RateLimit { amount_in_flight: 0, last_updated: 0, limit, window },
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_multiple_outflows_with_both_disabled(
    dst_eid: u32, limit: u128, window: u64, amount_1: u256, amount_2: u256,
) {
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: false },
    );

    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);

    // Multiple outflows that would exceed the limit if it were enforced
    limiter.mock_rate_limiter.outflow(dst_eid, amount_1);
    limiter.mock_rate_limiter.outflow(dst_eid, amount_2);

    // Amount in flight should remain 0 since tracking is disabled
    assert_eq(limiter.rate_limiter.get_outbound_rate_limit(dst_eid).amount_in_flight, 0);
}

#[test]
#[fuzzer(runs: 10)]
fn test_get_receivable_amount_after_inflow_with_both_enabled(
    dst_eid: u32, limit: u128, window: u64, amount: u128,
) {
    let amount = min(amount, limit);
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
    );

    // Set both outbound and inbound rate limits
    limiter.mock_rate_limiter.set_rate_limits(array![RateLimitConfig { dst_eid, limit, window }]);
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(array![RateLimitConfig { dst_eid, limit, window }]);

    // Inflow some amount
    limiter.mock_rate_limiter.inflow(dst_eid, amount.into());

    // Check receivable amount (inbound tracking)
    let receivable = limiter.rate_limiter.get_receivable_amount(dst_eid);
    assert_eq(receivable.amount_in_flight, amount.into());
    assert_eq(receivable.receivable_amount, limit.into() - amount.into());
}

// ============================================================================
// Tests for set_rate_limits checkpoint corner cases
// ============================================================================

#[test]
#[fuzzer(runs: 10)]
fn test_set_inbound_rate_limit_with_state_checkpoint(
    dst_eid: u32,
    limit_1: u128,
    window_1: u16,
    limit_2: u128,
    window_2: u16,
    amount: u128,
    duration: u16,
) {
    let limit_1 = limit_1.into();
    let window_1 = window_1.into();
    let limit_2 = limit_2.into();
    let window_2 = window_2.into();
    let duration = duration.into() + 1;
    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: false, is_inbound_enabled: true },
    );

    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(
            array![RateLimitConfig { dst_eid, limit: limit_1, window: window_1 }],
        );
    // Hit the inbound rate limit.
    limiter.mock_rate_limiter.inflow(dst_eid, limit_1.into());

    assert_eq(limiter.rate_limiter.get_receivable_amount(dst_eid).amount_in_flight, limit_1.into());

    cheat_block_timestamp(limiter.address, duration, CheatSpan::Indefinite);
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(
            array![RateLimitConfig { dst_eid, limit: limit_2, window: window_2 }],
        );

    let limit_1: u256 = limit_1.into();
    let amount_in_flight: u256 = limit_1
        .saturating_sub(limit_1.into() * duration.into() / window_1.into())
        .try_into()
        .unwrap();

    assert_eq(
        limiter.rate_limiter.get_receivable_amount(dst_eid).amount_in_flight, amount_in_flight,
    );
}

#[test]
#[fuzzer(runs: 10)]
fn test_set_inbound_limit_after_inbound_traffic_with_both_enabled(
    dst_eid: u32, limit_1: u128, limit_2: u128, window: u16, amount: u128, duration: u16,
) {
    let limit_1 = limit_1.into();
    let limit_2 = limit_2.into();
    let window: u64 = window.saturating_add(1).into();
    let amount = min(amount, limit_1);
    let duration = duration.into();

    let limiter = deploy_mock_rate_limiter_with_enabled(
        RateLimitEnabled { is_outbound_enabled: true, is_inbound_enabled: true },
    );

    // Set initial inbound rate limit
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(
            array![RateLimitConfig { dst_eid, limit: limit_1, window: window.into() }],
        );

    // Inflow some amount
    limiter.mock_rate_limiter.inflow(dst_eid, amount.into());

    assert_eq(limiter.rate_limiter.get_receivable_amount(dst_eid).amount_in_flight, amount.into());

    // Wait some time
    cheat_block_timestamp(limiter.address, duration, CheatSpan::Indefinite);

    // Update the inbound rate limit - this checkpoints BOTH directions per EVM behavior
    limiter
        .mock_rate_limiter
        .set_rate_limits_inbound(
            array![RateLimitConfig { dst_eid, limit: limit_2, window: window.into() }],
        );

    // The checkpoint should have decayed the amount_in_flight
    let amount: u256 = amount.into();
    let expected_in_flight = amount
        .saturating_sub(limit_1.into() * duration.into() / window.into());

    assert_eq(
        limiter.rate_limiter.get_receivable_amount(dst_eid).amount_in_flight, expected_in_flight,
    );
}
