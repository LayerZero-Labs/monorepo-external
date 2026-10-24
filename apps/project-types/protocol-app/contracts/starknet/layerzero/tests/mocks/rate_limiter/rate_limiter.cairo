//! Mock rate limiter contract for testing

#[starknet::contract]
pub mod MockRateLimiter {
    use RateLimiterComponent::RateLimiterHooks;
    use layerzero::oapps::common::rate_limiter::rate_limiter::{
        RateLimiterComponent, RateLimiterHooksDefaultImpl,
    };
    use layerzero::oapps::common::rate_limiter::structs::{
        RateLimitConfig, RateLimitDirection, RateLimitEnabled,
    };
    use crate::mocks::rate_limiter::interface::IMockRateLimiter;

    component!(path: RateLimiterComponent, storage: rate_limiter, event: RateLimiterEvent);

    #[abi(embed_v0)]
    impl RateLimiterImpl = RateLimiterComponent::RateLimiterImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        rate_limiter: RateLimiterComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        RateLimiterEvent: RateLimiterComponent::Event,
    }

    #[abi(embed_v0)]
    impl IMockRateLimiterImpl of IMockRateLimiter<ContractState> {
        fn set_rate_limit_enabled(ref self: ContractState, enabled: RateLimitEnabled) {
            self.rate_limiter._set_rate_limit_enabled(enabled);
        }

        fn set_rate_limits(ref self: ContractState, configs: Array<RateLimitConfig>) {
            self.rate_limiter._set_rate_limits(configs, RateLimitDirection::Outbound);
        }

        fn set_rate_limits_inbound(ref self: ContractState, configs: Array<RateLimitConfig>) {
            self.rate_limiter._set_rate_limits(configs, RateLimitDirection::Inbound);
        }

        fn reset_rate_limits(ref self: ContractState, eids: Array<u32>) {
            self.rate_limiter._reset_rate_limits(eids);
        }

        fn outflow(ref self: ContractState, dst_eid: u32, amount: u256) {
            self.rate_limiter._outflow(dst_eid, amount);
        }

        fn inflow(ref self: ContractState, src_eid: u32, amount: u256) {
            self.rate_limiter._inflow(src_eid, amount);
        }
    }
}
