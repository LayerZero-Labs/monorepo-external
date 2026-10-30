use crate::oapps::common::rate_limiter::structs::{
    RateLimitConfig, RateLimitDirection, RateLimitEnabled,
};

/// An event when rate limits are changed.
#[derive(Debug, Drop, starknet::Event)]
pub struct RateLimitsChanged {
    /// Rate limit configurations.
    pub configs: Array<RateLimitConfig>,
    /// Rate limit direction.
    pub direction: RateLimitDirection,
}

/// An event when rate limits are reset.
#[derive(Debug, Drop, starknet::Event)]
pub struct RateLimitsReset {
    /// Endpoint IDs that were reset.
    pub eids: Array<u32>,
}

/// An event when the rate limit is enabled.
#[derive(Debug, Drop, starknet::Event)]
pub struct RateLimitEnabledChanged {
    /// Rate limit enabled.
    pub rate_limit_enabled: RateLimitEnabled,
}
