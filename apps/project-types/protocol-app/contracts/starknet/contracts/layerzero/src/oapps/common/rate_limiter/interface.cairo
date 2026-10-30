use crate::oapps::common::rate_limiter::structs::{
    RateLimit, RateLimitEnabled, ReceivableAmount, SendableAmount,
};

/// An interface for a rate limiter component.
#[starknet::interface]
pub trait IRateLimiter<TContractState> {
    /// Gets the current amount that can be sent to the destination endpoint ID for the given rate
    /// limit window.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID.
    ///
    /// # Returns
    /// * `SendableAmount` - The sendable amount.
    fn get_sendable_amount(self: @TContractState, dst_eid: u32) -> SendableAmount;

    /// Gets the current amount that can be received from the source endpoint ID for the given
    /// rate limit window.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID.
    ///
    /// # Returns
    /// * `ReceivableAmount` - The receivable amount.
    fn get_receivable_amount(self: @TContractState, src_eid: u32) -> ReceivableAmount;

    /// Gets the current outbound rate limit for the destination endpoint ID.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID.
    ///
    /// # Returns
    /// * `RateLimit` - The rate limit state.
    fn get_outbound_rate_limit(self: @TContractState, dst_eid: u32) -> RateLimit;

    /// Gets the current inbound rate limit for the source endpoint ID.
    ///
    /// # Arguments
    /// * `src_eid` - The source endpoint ID.
    ///
    /// # Returns
    /// * `RateLimit` - The rate limit state.
    fn get_inbound_rate_limit(self: @TContractState, src_eid: u32) -> RateLimit;

    /// Gets enabled configuration of rate limits.
    fn get_rate_limit_enabled(self: @TContractState) -> RateLimitEnabled;
}
