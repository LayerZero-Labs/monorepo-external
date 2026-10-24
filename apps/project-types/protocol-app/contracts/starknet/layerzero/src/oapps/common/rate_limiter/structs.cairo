/// A rate limit state for a destination endpoint ID.
#[derive(Drop, Serde, Default, starknet::Store, PartialEq, Debug)]
pub struct RateLimit {
    /// An amount in flight.
    pub amount_in_flight: u128,
    /// A timestamp from which we calculate decays.
    pub last_updated: u64,
    /// An amount limit of the rate.
    pub limit: u128,
    /// A time window of the rate.
    pub window: u64,
}

/// A rate limit configuration.
#[derive(Clone, Drop, Serde, Default, starknet::Store, PartialEq, Debug)]
pub struct RateLimitConfig {
    /// A destination endpoint ID.
    pub dst_eid: u32,
    /// An amount limit of the rate.
    pub limit: u128,
    /// A time window of the rate.
    pub window: u64,
}

/// A flowable amount.
#[derive(Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct FlowableAmount {
    /// The current amount that is flowing.
    pub amount_in_flight: u256,
    /// An amount that can be sent.
    pub flowable_amount: u256,
}

#[derive(Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct SendableAmount {
    /// The current amount that is flowing.
    pub amount_in_flight: u256,
    /// An amount that can be sent.
    pub sendable_amount: u256,
}

#[derive(Drop, Serde, starknet::Store, PartialEq, Debug)]
pub struct ReceivableAmount {
    /// The current amount that is flowing.
    pub amount_in_flight: u256,
    /// An amount that can be received.
    pub receivable_amount: u256,
}

#[derive(Drop, Serde, PartialEq, Debug, Copy)]
pub enum RateLimitDirection {
    Outbound,
    Inbound,
}

#[derive(Drop, Serde, Default, starknet::Store, PartialEq, Debug, Copy)]
pub struct RateLimitEnabled {
    pub is_outbound_enabled: bool,
    pub is_inbound_enabled: bool,
}
