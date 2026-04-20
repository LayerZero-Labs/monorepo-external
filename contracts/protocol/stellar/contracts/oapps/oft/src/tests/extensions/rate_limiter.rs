extern crate std;

use crate as oft;
use crate::extensions::rate_limiter::{
    Direction, Mode, RateLimitConfig, RateLimitError, RateLimiter, RateLimiterInternal,
};
use crate::extensions::rate_limiter::RATE_LIMITER_MANAGER_ROLE;
use soroban_sdk::{contract, contractimpl, testutils::Ledger as _, Address, Env, Symbol};
use utils::auth::Auth;
use utils::rbac::{grant_role_no_auth, RoleBasedAccessControl};

// ============================================================================
// Test Contract
// ============================================================================

#[contract]
struct RateLimiterTestContract;

impl Auth for RateLimiterTestContract {
    fn authorizer(env: &Env) -> Option<Address> {
        Some(env.current_contract_address())
    }
}

impl RateLimiterInternal for RateLimiterTestContract {}

#[contractimpl(contracttrait)]
impl RateLimiter for RateLimiterTestContract {}

#[contractimpl(contracttrait)]
impl RoleBasedAccessControl for RateLimiterTestContract {}

#[contractimpl]
impl RateLimiterTestContract {
    /// Test-only: grants RATE_LIMITER_MANAGER_ROLE to the contract.
    pub fn init_roles(env: Env) {
        let contract_id = env.current_contract_address();
        grant_role_no_auth(
            &env,
            &contract_id,
            &Symbol::new(&env, RATE_LIMITER_MANAGER_ROLE),
            &contract_id,
        );
    }

    pub fn consume(env: Env, direction: Direction, eid: u32, amount: i128) {
        <Self as RateLimiterInternal>::__consume_rate_limit_capacity(&env, &direction, eid, amount)
    }

    pub fn release(env: Env, direction: Direction, eid: u32, amount: i128) {
        <Self as RateLimiterInternal>::__release_rate_limit_capacity(&env, &direction, eid, amount)
    }
}

// ============================================================================
// Test Setup
// ============================================================================

struct TestSetup {
    env: Env,
    client: RateLimiterTestContractClient<'static>,
    contract_id: Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    // Enable mock_all_auths_allowing_non_root_auth for all tests to bypass authorization checks
    // including sub-contract invocations
    env.mock_all_auths_allowing_non_root_auth();

    let contract_id = env.register(RateLimiterTestContract, ());
    let client = RateLimiterTestContractClient::new(&env, &contract_id);
    client.init_roles();
    TestSetup { env, client, contract_id }
}

fn config(limit: i128, window_seconds: u64) -> RateLimitConfig {
    RateLimitConfig { limit, window_seconds, mode: Mode::Net }
}

fn config_with_mode(limit: i128, window_seconds: u64, mode: Mode) -> RateLimitConfig {
    RateLimitConfig { limit, window_seconds, mode }
}

// ============================================================================
// No Config Tests
// ============================================================================

#[test]
fn test_no_config_is_unlimited() {
    let TestSetup { client, .. } = setup();

    assert_eq!(client.rate_limit_capacity(&Direction::Outbound, &1u32), i128::MAX);
    assert_eq!(client.rate_limit_in_flight(&Direction::Outbound, &1u32), 0);
}

#[test]
fn test_no_config_consume_and_release_are_noop() {
    let TestSetup { client, .. } = setup();

    client.consume(&Direction::Outbound, &1u32, &999i128);
    assert_eq!(client.rate_limit_in_flight(&Direction::Outbound, &1u32), 0);

    client.release(&Direction::Outbound, &1u32, &999i128);
    assert_eq!(client.rate_limit_in_flight(&Direction::Outbound, &1u32), 0);
}

// ============================================================================
// Set Rate Limit Tests
// ============================================================================

#[test]
fn test_set_rate_limit_rejects_invalid_config() {
    let TestSetup { client, contract_id, .. } = setup();

    // Invalid: window_seconds == 0
    let res = client.try_set_rate_limit(&Direction::Outbound, &1u32, &Some(config(10, 0)), &contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::InvalidConfig.into());

    // Invalid: limit < 0
    let res2 = client.try_set_rate_limit(&Direction::Outbound, &1u32, &Some(config(-1, 10)), &contract_id);
    assert_eq!(res2.err().unwrap().ok().unwrap(), RateLimitError::InvalidConfig.into());
}

#[test]
fn test_set_rate_limit_rejects_same_value() {
    let TestSetup { client, contract_id, .. } = setup();

    // SameValue when removing a non-existent config.
    let res = client.try_set_rate_limit(&Direction::Outbound, &1u32, &None, &contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::SameValue.into());

    // Set a valid config; setting same again should be SameValue.
    let cfg = config(100, 10);
    client.set_rate_limit(&Direction::Outbound, &1u32, &Some(cfg.clone()), &contract_id);
    let res2 = client.try_set_rate_limit(&Direction::Outbound, &1u32, &Some(cfg), &contract_id);
    assert_eq!(res2.err().unwrap().ok().unwrap(), RateLimitError::SameValue.into());
}

// ============================================================================
// Consume and Release Tests
// ============================================================================

#[test]
fn test_consume_rejects_negative_amount() {
    let TestSetup { client, contract_id, .. } = setup();

    client.set_rate_limit(&Direction::Outbound, &1u32, &Some(config(100, 100)), &contract_id);

    let res = client.try_consume(&Direction::Outbound, &1u32, &-1i128);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::InvalidAmount.into());
}

#[test]
fn test_release_rejects_negative_amount() {
    let TestSetup { client, contract_id, .. } = setup();

    client.set_rate_limit(&Direction::Outbound, &1u32, &Some(config(100, 100)), &contract_id);

    let res = client.try_release(&Direction::Outbound, &1u32, &-1i128);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::InvalidAmount.into());
}

#[test]
fn test_consume_within_capacity() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 77u32;

    client.set_rate_limit(&direction, &eid, &Some(config(100, 100)), &contract_id);

    client.consume(&direction, &eid, &60i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 60);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 40);
}

#[test]
fn test_consume_exceeds_capacity() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 77u32;

    client.set_rate_limit(&direction, &eid, &Some(config(100, 100)), &contract_id);
    client.consume(&direction, &eid, &60i128);

    let res = client.try_consume(&direction, &eid, &41i128);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::ExceededRateLimit.into());
}

#[test]
fn test_release_reduces_in_flight() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 77u32;

    client.set_rate_limit(&direction, &eid, &Some(config(100, 100)), &contract_id);
    client.consume(&direction, &eid, &60i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 60);

    client.release(&direction, &eid, &10i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 50);

    // Release more than in-flight clamps to 0.
    client.release(&direction, &eid, &999i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 0);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 100);
}

// ============================================================================
// Decay Tests
// ============================================================================

#[test]
fn test_decay_reduces_in_flight_over_time() {
    let TestSetup { env, client, contract_id } = setup();
    let direction = Direction::Outbound;
    let eid = 5u32;

    env.ledger().set_timestamp(1_000);
    client.set_rate_limit(&direction, &eid, &Some(config(100, 10)), &contract_id);

    client.consume(&direction, &eid, &100i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 100);

    // Advance 5 seconds => decay 50.
    env.ledger().set_timestamp(1_005);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 50);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 50);
}

#[test]
fn test_timestamp_regression_errors() {
    let TestSetup { env, client, contract_id } = setup();
    let direction = Direction::Outbound;
    let eid = 5u32;

    env.ledger().set_timestamp(1_000);
    client.set_rate_limit(&direction, &eid, &Some(config(100, 10)), &contract_id);
    client.consume(&direction, &eid, &100i128);

    // Set timestamp backwards => should error.
    env.ledger().set_timestamp(999);
    let res = client.try_rate_limit_in_flight(&direction, &eid);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::InvalidTimestamp.into());
}

// ============================================================================
// Config Update Tests
// ============================================================================

#[test]
fn test_updating_config_checkpoints_in_flight() {
    let TestSetup { env, client, contract_id } = setup();
    let direction = Direction::Outbound;
    let eid = 42u32;

    env.ledger().set_timestamp(1_000);
    client.set_rate_limit(&direction, &eid, &Some(config(100, 10)), &contract_id);
    client.consume(&direction, &eid, &100i128);

    // Move forward, then update config.
    env.ledger().set_timestamp(1_005);
    client.set_rate_limit(&direction, &eid, &Some(config(200, 20)), &contract_id);

    // At t=1005, old config would have decayed to 50.
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 50);

    // After 10 more seconds, new config decay should clear it.
    env.ledger().set_timestamp(1_015);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 0);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 200);
}

#[test]
fn test_reducing_limit_below_in_flight_clamps_capacity() {
    let TestSetup { env, client, contract_id } = setup();
    let direction = Direction::Inbound;
    let eid = 123u32;

    env.ledger().set_timestamp(1_000);
    client.set_rate_limit(&direction, &eid, &Some(config(100, 100)), &contract_id);
    client.consume(&direction, &eid, &90i128);

    // Reduce limit below in-flight.
    client.set_rate_limit(&direction, &eid, &Some(config(50, 100)), &contract_id);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 0);
}

#[test]
fn test_removing_rate_limit_makes_unlimited() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Inbound;
    let eid = 321u32;

    client.set_rate_limit(&direction, &eid, &Some(config(10, 10)), &contract_id);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 10);

    client.set_rate_limit(&direction, &eid, &None, &contract_id);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), i128::MAX);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 0);
}

// ============================================================================
// Rate Limit Config View Tests
// ============================================================================

#[test]
fn test_rate_limit_config_returns_none_when_unset() {
    let TestSetup { client, .. } = setup();

    assert_eq!(client.rate_limit_config(&Direction::Outbound, &999u32), None);
    assert_eq!(client.rate_limit_config(&Direction::Inbound, &888u32), None);
}

#[test]
fn test_rate_limit_config_returns_config_when_set() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 42u32;

    let cfg = config(500, 60);
    client.set_rate_limit(&direction, &eid, &Some(cfg.clone()), &contract_id);

    let result = client.rate_limit_config(&direction, &eid);
    assert_eq!(result, Some(cfg));
}

#[test]
fn test_rate_limit_config_returns_none_after_removal() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Inbound;
    let eid = 77u32;

    client.set_rate_limit(&direction, &eid, &Some(config(100, 10)), &contract_id);
    assert!(client.rate_limit_config(&direction, &eid).is_some());

    client.set_rate_limit(&direction, &eid, &None, &contract_id);
    assert_eq!(client.rate_limit_config(&direction, &eid), None);
}

// ============================================================================
// Direction Independence Tests
// ============================================================================

#[test]
fn test_inbound_outbound_are_independent() {
    let TestSetup { client, contract_id, .. } = setup();
    let eid = 10u32;

    // Set different configs for inbound and outbound
    client.set_rate_limit(&Direction::Inbound, &eid, &Some(config(100, 10)), &contract_id);
    client.set_rate_limit(&Direction::Outbound, &eid, &Some(config(200, 20)), &contract_id);

    assert_eq!(client.rate_limit_config(&Direction::Inbound, &eid), Some(config(100, 10)));
    assert_eq!(client.rate_limit_config(&Direction::Outbound, &eid), Some(config(200, 20)));

    // Consume from one direction doesn't affect the other
    client.consume(&Direction::Inbound, &eid, &50i128);
    assert_eq!(client.rate_limit_in_flight(&Direction::Inbound, &eid), 50);
    assert_eq!(client.rate_limit_in_flight(&Direction::Outbound, &eid), 0);
}

#[test]
fn test_different_eids_are_independent() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;

    client.set_rate_limit(&direction, &1u32, &Some(config(100, 10)), &contract_id);
    client.set_rate_limit(&direction, &2u32, &Some(config(200, 20)), &contract_id);

    client.consume(&direction, &1u32, &50i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &1u32), 50);
    assert_eq!(client.rate_limit_in_flight(&direction, &2u32), 0);
}

// ============================================================================
// Gross Mode Tests
// ============================================================================

#[test]
fn test_gross_mode_does_not_release_capacity() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 77u32;

    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 100, Mode::Gross)), &contract_id);
    client.consume(&direction, &eid, &60i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 60);

    // Release should be a no-op in Gross mode
    client.release(&direction, &eid, &30i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 60, "Gross mode should not release");
}

#[test]
fn test_net_mode_does_release_capacity() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 77u32;

    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 100, Mode::Net)), &contract_id);
    client.consume(&direction, &eid, &60i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 60);

    // Release should reduce in-flight in Net mode
    client.release(&direction, &eid, &30i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 30, "Net mode should release");
}

#[test]
fn test_gross_mode_enforces_absolute_limit() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 100, Mode::Gross)), &contract_id);

    // Consume 80
    client.consume(&direction, &eid, &80i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 80);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 20);

    // Try to release 50 (should be no-op)
    client.release(&direction, &eid, &50i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 80);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 20);

    // Should only be able to consume 20 more
    client.consume(&direction, &eid, &20i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 100);

    // Should fail to consume more
    let res = client.try_consume(&direction, &eid, &1i128);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::ExceededRateLimit.into());
}

#[test]
fn test_gross_mode_decay_still_works() {
    let TestSetup { env, client, contract_id } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    env.ledger().set_timestamp(1_000);
    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 10, Mode::Gross)), &contract_id);

    // Consume full capacity
    client.consume(&direction, &eid, &100i128);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 0);

    // Release should not affect in-flight in Gross mode
    client.release(&direction, &eid, &50i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 100);

    // Advance time by 5 seconds => decay 50
    env.ledger().set_timestamp(1_005);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 50);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 50);
}

#[test]
fn test_switching_from_net_to_gross_mode() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    // Start with Net mode
    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 100, Mode::Net)), &contract_id);
    client.consume(&direction, &eid, &60i128);
    client.release(&direction, &eid, &20i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 40, "Net mode should release");

    // Switch to Gross mode
    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 100, Mode::Gross)), &contract_id);

    // in-flight should be checkpointed
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 40);

    // Now releases should be no-op
    client.release(&direction, &eid, &20i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 40, "Gross mode should not release");
}

#[test]
fn test_switching_from_gross_to_net_mode() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    // Start with Gross mode
    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 100, Mode::Gross)), &contract_id);
    client.consume(&direction, &eid, &60i128);
    client.release(&direction, &eid, &20i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 60, "Gross mode should not release");

    // Switch to Net mode
    client.set_rate_limit(&direction, &eid, &Some(config_with_mode(100, 100, Mode::Net)), &contract_id);

    // in-flight should be checkpointed
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 60);

    // Now releases should work
    client.release(&direction, &eid, &20i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 40, "Net mode should release");
}

// ============================================================================
// Edge Case Tests
// ============================================================================

#[test]
fn test_consume_zero_amount_succeeds() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    client.set_rate_limit(&direction, &eid, &Some(config(100, 100)), &contract_id);

    // Consuming zero should succeed
    client.consume(&direction, &eid, &0i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 0);
}

#[test]
fn test_release_zero_amount_succeeds() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    client.set_rate_limit(&direction, &eid, &Some(config(100, 100)), &contract_id);
    client.consume(&direction, &eid, &50i128);

    // Releasing zero should succeed
    client.release(&direction, &eid, &0i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 50);
}

#[test]
fn test_consume_exact_capacity() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    client.set_rate_limit(&direction, &eid, &Some(config(100, 100)), &contract_id);

    // Consuming exact capacity should succeed
    client.consume(&direction, &eid, &100i128);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 100);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 0);
}

#[test]
fn test_decay_fully_restores_capacity() {
    let TestSetup { env, client, contract_id } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    env.ledger().set_timestamp(1_000);
    client.set_rate_limit(&direction, &eid, &Some(config(100, 10)), &contract_id);

    client.consume(&direction, &eid, &100i128);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 0);

    // Advance full window => full decay
    env.ledger().set_timestamp(1_010);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 0);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 100);
}

#[test]
fn test_decay_beyond_window_clamps_to_zero() {
    let TestSetup { env, client, contract_id } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    env.ledger().set_timestamp(1_000);
    client.set_rate_limit(&direction, &eid, &Some(config(100, 10)), &contract_id);

    client.consume(&direction, &eid, &50i128);

    // Advance way beyond window
    env.ledger().set_timestamp(2_000);
    assert_eq!(client.rate_limit_in_flight(&direction, &eid), 0);
}

#[test]
fn test_limit_zero_blocks_all_consumption() {
    let TestSetup { client, contract_id, .. } = setup();
    let direction = Direction::Outbound;
    let eid = 1u32;

    // Set limit to 0 (valid config)
    client.set_rate_limit(&direction, &eid, &Some(config(0, 10)), &contract_id);
    assert_eq!(client.rate_limit_capacity(&direction, &eid), 0);

    // Any non-zero consumption should fail
    let res = client.try_consume(&direction, &eid, &1i128);
    assert_eq!(res.err().unwrap().ok().unwrap(), RateLimitError::ExceededRateLimit.into());

    // Zero consumption should still succeed
    client.consume(&direction, &eid, &0i128);
}
