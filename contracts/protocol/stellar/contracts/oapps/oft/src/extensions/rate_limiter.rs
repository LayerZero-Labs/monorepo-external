use crate as oft;
use common_macros::{contract_error, contract_trait, only_role, storage};
use soroban_sdk::{assert_with_error, contractevent, contracttype, Env};
use utils::rbac::RoleBasedAccessControl;

/// Role for rate limiter configuration (set_rate_limit).
pub const RATE_LIMITER_MANAGER_ROLE: &str = "RATE_LIMITER_MANAGER_ROLE";

// =========================================================================
// Types
// =========================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Direction {
    Inbound,
    Outbound,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Mode {
    /// Net rate limit: releases decrement in-flight amount
    Net,
    /// Gross rate limit: releases do not affect in-flight amount
    Gross,
}

/// Configuration for rate limiting, used as input parameter.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateLimitConfig {
    pub limit: i128,
    pub window_seconds: u64,
    pub mode: Mode,
}

/// Internal storage struct for rate limit state.
///
/// The rate limiter uses a "leaky bucket" algorithm where:
/// - `config.limit` defines the maximum tokens that can be "in flight" at any time
/// - `config.window_seconds` defines how long it takes for the bucket to fully drain
/// - Tokens decay linearly over time: `decay = elapsed_time * limit / window_seconds`
/// - Current in-flight = `in_flight_on_last_update - decay` (clamped to 0)
/// - `config.mode` determines whether releases affect in-flight (Net) or not (Gross)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct RateLimitState {
    /// The rate limit configuration (limit and window_seconds)
    config: RateLimitConfig,
    /// The in-flight amount at the time of `last_update` (before decay is applied)
    in_flight_on_last_update: i128,
    /// Timestamp of the last update (used to calculate decay)
    last_update: u64,
}

// =========================================================================
// Storage
// =========================================================================

#[storage]
enum RateLimitStorage {
    #[persistent(RateLimitState)]
    RateLimit { direction: Direction, eid: u32 },
}

// =========================================================================
// Errors
// =========================================================================

#[contract_error]
pub enum RateLimitError {
    ExceededRateLimit = 3120,
    InvalidAmount,
    InvalidTimestamp,
    InvalidConfig,
    SameValue,
}

// =========================================================================
// Events
// =========================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateLimitSet {
    pub direction: Direction,
    pub eid: u32,
    /// The rate limit configuration, or None if the rate limit is removed
    pub config: Option<RateLimitConfig>,
}

// =========================================================================
// Trait With Default Implementations
// =========================================================================

#[contract_trait]
pub trait RateLimiter: RateLimiterInternal + RoleBasedAccessControl {
    // =========================================================================
    // Management Functions
    // =========================================================================

    /// Sets or removes a rate limit for a specific direction and endpoint.
    ///
    /// # Arguments
    /// * `direction` - The direction (Inbound or Outbound)
    /// * `eid` - The endpoint ID
    /// * `config` - The rate limit configuration, or None to remove the rate limit
    /// * `operator` - The address that must have RATE_LIMITER_MANAGER_ROLE
    #[only_role(operator, RATE_LIMITER_MANAGER_ROLE)]
    fn set_rate_limit(
        env: &soroban_sdk::Env,
        direction: &oft::rate_limiter::Direction,
        eid: u32,
        config: &Option<oft::rate_limiter::RateLimitConfig>,
        operator: &soroban_sdk::Address,
    ) {
        Self::__set_rate_limit(env, direction, eid, config);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// Returns the rate limit configuration for a direction and endpoint.
    /// Returns None if no rate limit is configured.
    fn rate_limit_config(
        env: &soroban_sdk::Env,
        direction: &oft::rate_limiter::Direction,
        eid: u32,
    ) -> Option<oft::rate_limiter::RateLimitConfig> {
        Self::__rate_limit_config(env, direction, eid)
    }

    /// Returns the current in-flight amount for a direction and endpoint.
    fn rate_limit_in_flight(env: &soroban_sdk::Env, direction: &oft::rate_limiter::Direction, eid: u32) -> i128 {
        Self::__rate_limit_in_flight(env, direction, eid)
    }

    /// Returns the available capacity for a direction and endpoint.
    /// Returns i128::MAX if no rate limit is configured.
    fn rate_limit_capacity(env: &soroban_sdk::Env, direction: &oft::rate_limiter::Direction, eid: u32) -> i128 {
        Self::__rate_limit_capacity(env, direction, eid)
    }
}

/// Internal trait for rate limiter operations used by OFT hooks.
/// Contains only truly internal methods that are called from OFTInternal implementations.
pub trait RateLimiterInternal {
    // =========================================================================
    // OFT Hooks
    // =========================================================================

    /// Consumes the specified amount from the rate limit capacity.
    /// Used internally by `__debit` and `__credit` to enforce rate limits.
    ///
    /// # Errors
    /// * `ExceededRateLimit` - If the amount exceeds the available capacity.
    fn __consume_rate_limit_capacity(env: &Env, direction: &Direction, eid: u32, amount: i128) {
        assert_with_error!(env, amount >= 0, RateLimitError::InvalidAmount);

        let Some(mut state) = RateLimitStorage::rate_limit(env, direction, eid) else {
            return;
        };

        // Apply decay and update timestamp
        let in_flight = calculate_decayed_in_flight(env, &state);
        state.in_flight_on_last_update = in_flight;
        state.last_update = env.ledger().timestamp();

        // Check capacity and consume
        let capacity = (state.config.limit - in_flight).max(0);
        assert_with_error!(env, amount <= capacity, RateLimitError::ExceededRateLimit);
        state.in_flight_on_last_update += amount;

        RateLimitStorage::set_rate_limit(env, direction, eid, &state);
    }

    /// Releases the specified amount back to the rate limit capacity.
    /// Used internally by `__credit` to release outbound capacity on inbound messages.
    /// Only releases for Net mode; Gross mode ignores releases.
    fn __release_rate_limit_capacity(env: &Env, direction: &Direction, eid: u32, amount: i128) {
        assert_with_error!(env, amount >= 0, RateLimitError::InvalidAmount);

        let Some(mut state) = RateLimitStorage::rate_limit(env, direction, eid) else {
            return;
        };

        // Gross mode does not release capacity
        if state.config.mode == Mode::Gross {
            return;
        }

        // Apply decay and update timestamp
        let in_flight = calculate_decayed_in_flight(env, &state);
        state.in_flight_on_last_update = (in_flight - amount).max(0);
        state.last_update = env.ledger().timestamp();

        RateLimitStorage::set_rate_limit(env, direction, eid, &state);
    }

    // =========================================================================
    // Management Functions
    // =========================================================================

    /// Sets or removes a rate limit for a specific direction and endpoint.
    ///
    /// # Arguments
    /// * `direction` - The direction (Inbound or Outbound)
    /// * `eid` - The endpoint ID
    /// * `config` - The rate limit configuration, or None to remove the rate limit
    fn __set_rate_limit(env: &Env, direction: &Direction, eid: u32, config: &Option<RateLimitConfig>) {
        let current_state = RateLimitStorage::rate_limit(env, direction, eid);
        let current_config = current_state.as_ref().map(|s| s.config.clone());
        assert_with_error!(env, current_config != *config, RateLimitError::SameValue);

        match config {
            Some(cfg) => {
                assert_with_error!(env, cfg.limit >= 0 && cfg.window_seconds > 0, RateLimitError::InvalidConfig);

                let state = if let Some(mut existing) = current_state {
                    // Update existing: checkpoint in-flight before changing config
                    existing.in_flight_on_last_update = calculate_decayed_in_flight(env, &existing);
                    existing.last_update = env.ledger().timestamp();
                    existing.config = cfg.clone();
                    existing
                } else {
                    // Create new
                    RateLimitState {
                        config: cfg.clone(),
                        in_flight_on_last_update: 0,
                        last_update: env.ledger().timestamp(),
                    }
                };

                RateLimitStorage::set_rate_limit(env, direction, eid, &state);
            }
            None => {
                RateLimitStorage::remove_rate_limit(env, direction, eid);
            }
        }
        RateLimitSet { direction: direction.clone(), eid, config: config.clone() }.publish(env);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// Returns the rate limit configuration for a direction and endpoint.
    /// Returns None if no rate limit is configured.
    fn __rate_limit_config(env: &Env, direction: &Direction, eid: u32) -> Option<RateLimitConfig> {
        RateLimitStorage::rate_limit(env, direction, eid).map(|s| s.config)
    }

    /// Returns the current in-flight amount for a direction and endpoint.
    fn __rate_limit_in_flight(env: &Env, direction: &Direction, eid: u32) -> i128 {
        RateLimitStorage::rate_limit(env, direction, eid).map(|s| calculate_decayed_in_flight(env, &s)).unwrap_or(0)
    }

    /// Returns the available capacity for a direction and endpoint.
    /// Returns i128::MAX if no rate limit is configured.
    fn __rate_limit_capacity(env: &Env, direction: &Direction, eid: u32) -> i128 {
        RateLimitStorage::rate_limit(env, direction, eid)
            .map(|s| (s.config.limit - calculate_decayed_in_flight(env, &s)).max(0))
            .unwrap_or(i128::MAX)
    }
}

// =========================================================================
// Helper Functions
// =========================================================================

/// Calculates the current in-flight amount with decay applied.
/// This is a pure function that doesn't access storage.
fn calculate_decayed_in_flight(env: &Env, state: &RateLimitState) -> i128 {
    let timestamp = env.ledger().timestamp();
    assert_with_error!(env, timestamp >= state.last_update, RateLimitError::InvalidTimestamp);

    let elapsed = timestamp - state.last_update;
    let decay = (elapsed as i128).saturating_mul(state.config.limit) / (state.config.window_seconds as i128);

    // Ensure the decayed in-flight amount is not negative
    (state.in_flight_on_last_update - decay).max(0)
}
