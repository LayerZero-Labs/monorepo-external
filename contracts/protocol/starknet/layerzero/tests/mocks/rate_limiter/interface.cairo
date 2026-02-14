use layerzero::oapps::common::rate_limiter::structs::{RateLimitConfig, RateLimitEnabled};

#[starknet::interface]
pub trait IMockRateLimiter<TContractState> {
    fn set_rate_limit_enabled(ref self: TContractState, enabled: RateLimitEnabled);
    fn set_rate_limits(ref self: TContractState, configs: Array<RateLimitConfig>);
    fn set_rate_limits_inbound(ref self: TContractState, configs: Array<RateLimitConfig>);
    fn reset_rate_limits(ref self: TContractState, eids: Array<u32>);
    fn outflow(ref self: TContractState, dst_eid: u32, amount: u256);
    fn inflow(ref self: TContractState, src_eid: u32, amount: u256);
}
