//! RateLimiter component implementation

/// The rate limiter component.
///
/// It implements rate limiting functionality. This component provides a basic framework for rate
/// limiting how often a function can be executed.
/// It is designed to be embedded into other contracts requiring rate limiting capabilities to
/// protect resources or services from excessive use.
///
/// The ordering of transactions within a given block (timestamp) affects the consumed capacity.
/// Carefully consider the minimum window duration for the given blockchain. For example, on
/// Starknet, the minimum window duration should be at least 6 seconds as of September 1,
/// 2025. If a window less than the time is configured, then the rate limit will effectively
/// reset with each block, rendering rate limiting ineffective.
///
/// Carefully consider the proportion of the limit to the window. If the limit is much smaller
/// than the window, the decay function is lossy. Consider using a limit that is greater than or
/// equal to the window to avoid this. This is especially important for blockchains with short
/// average block times.
///
/// Example 1: Max rate limit reached at beginning of window. As time continues the amount of in
/// flights comes down.
///
/// Rate Limit Config:
///   limit: 100 units
///   window: 60 seconds
///
///                              Amount in Flight (units) vs. Time Graph (seconds)
///
///      100 | * - (Max limit reached at beginning of window)
///          |   *
///          |     *
///          |       *
///       50 |         * (After 30 seconds only 50 units in flight)
///          |           *
///          |             *
///          |               *
///       0  +-|---|---|---|---|--> (After 60 seconds 0 units are in flight)
///            0  15  30  45  60 (seconds)
///
/// Example 2: Max rate limit reached at beginning of window. As time continues the amount of in
/// flights comes down allowing for more to be sent. At the 90 second mark, more in flights come in.
///
/// Rate Limit Config:
///   limit: 100 units
///   window: 60 seconds
///
///                              Amount in Flight (units) vs. Time Graph (seconds)
///
///      100 | * - (Max limit reached at beginning of window)
///          |   *
///          |     *
///       50 |       *           * (50 inflight)
///          |         *           *
///          |           *           *
///          |             *           *
///        0 +-|--|--|--|--|--|--|--|--|--> Time
///            0 15 30 45 60 75 90 105 120 (seconds)
///
/// Example 3: Max rate limit reached at beginning of window. At the 30 second mark, the window gets
/// updated to 60 seconds and the limit gets updated to 50 units. This scenario shows the direct
/// depiction of "in flight" from the previous window affecting the current window.
///
/// Initial Rate Limit Config: For first 30 seconds
///   limit: 100 units
///   window: 60 seconds
///
/// Updated Rate Limit Config: Updated at 30 second mark
///   limit: 50 units
///   window: 60 seconds
///
///                              Amount in Flight (units) vs. Time Graph (seconds)
///
///      100 | * - (Max limit reached at beginning of window)
///          |   *
///          |     *
///       75 |       *
///          |         *
///          |           *
///          |             *
///       50 |               *
///          |                 . *
///          |                   .   *
///          |                     .     *
///       25 |                       .       *
///          |                         .         *
///          |                           .           *
///          |                             .             *
///        0 +-|-------------|-------------|-------------|---------> Time
///            0            30            60            90    (seconds)
///            [      original window      ]
///                          [       updated window      ]
#[starknet::component]
pub mod RateLimiterComponent {
    use core::cmp::max;
    use core::num::traits::SaturatingSub;
    use lz_utils::error::assert_with_byte_array;
    use starknet::get_block_timestamp;
    use starknet::storage::{
        Map, StorageMapReadAccess, StoragePathEntry, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use crate::oapps::common::rate_limiter::errors::err_rate_limit_exceeded;
    use crate::oapps::common::rate_limiter::events::{
        RateLimitEnabledChanged, RateLimitsChanged, RateLimitsReset,
    };
    use crate::oapps::common::rate_limiter::interface::IRateLimiter;
    use crate::oapps::common::rate_limiter::structs::{
        FlowableAmount, RateLimit, RateLimitConfig, RateLimitDirection, RateLimitEnabled,
        ReceivableAmount, SendableAmount,
    };

    #[storage]
    pub struct Storage {
        /// A map from endpoint IDs to their rate limit configurations and states.
        pub RateLimiter_outbound_rate_limits: Map<u32, RateLimit>,
        /// A map from endpoint IDs to their inbound rate limit configurations and states.
        pub RateLimiter_inbound_rate_limits: Map<u32, RateLimit>,
        /// Whether the outbound and inbound rate limits are enabled.
        pub RateLimiter_enabled: RateLimitEnabled,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RateLimitsChanged: RateLimitsChanged,
        RateLimitsReset: RateLimitsReset,
        RateLimitEnabledChanged: RateLimitEnabledChanged,
    }

    pub trait RateLimiterHooks<TContractState, +HasComponent<TContractState>> {
        fn _get_flowable_amount(
            self: @ComponentState<TContractState>, limit: @RateLimit,
        ) -> FlowableAmount {
            let RateLimit { amount_in_flight, last_updated, limit, window } = limit;

            // Prevent division by zero.
            let window = max(*window, 1);
            let duration = get_block_timestamp() - *last_updated;

            // Presume linear decay.
            let amount_in_flight: u256 = (*amount_in_flight)
                .into()
                .saturating_sub((*limit).into() * duration.into() / window.into());

            FlowableAmount {
                // Although the amount in flight should never be above the limit, we double-check
                // that with saturating subtraction.
                amount_in_flight, flowable_amount: (*limit).into().saturating_sub(amount_in_flight),
            }
        }

        /// Checks and updates the rate limit for the given endpoint ID and amount.
        ///
        /// For each direction we need to check and update the rate limit, and also update the
        /// opposite direction.
        /// but in case the direction is disabled, we don't need to update the rate limit.
        ///
        /// # Arguments
        /// * `eid` - The endpoint ID.
        /// * `amount` - The amount to check and update.
        /// * `direction` - The direction of the rate limit.
        ///
        /// # Panics
        /// Reverts if the rate limit is exceeded for the given direction.
        fn _check_and_update_rate_limit(
            ref self: ComponentState<TContractState>,
            eid: u32,
            amount: u256,
            direction: RateLimitDirection,
        ) {
            let RateLimitEnabled {
                is_outbound_enabled, is_inbound_enabled,
            } = self.RateLimiter_enabled.read();

            let is_direction_enabled = match direction {
                RateLimitDirection::Outbound => is_outbound_enabled,
                RateLimitDirection::Inbound => is_inbound_enabled,
            };

            if is_direction_enabled {
                let direction_entry = match direction {
                    RateLimitDirection::Outbound => self
                        .RateLimiter_outbound_rate_limits
                        .entry(eid),
                    RateLimitDirection::Inbound => self.RateLimiter_inbound_rate_limits.entry(eid),
                };

                let rate_limit = direction_entry.read();

                let FlowableAmount {
                    amount_in_flight, flowable_amount,
                } = Self::_get_flowable_amount(@self, @rate_limit);

                assert_with_byte_array(amount <= flowable_amount, err_rate_limit_exceeded());

                direction_entry
                    .write(
                        RateLimit {
                            amount_in_flight: (amount_in_flight + amount).try_into().unwrap(),
                            last_updated: get_block_timestamp(),
                            ..rate_limit,
                        },
                    );
            }

            let is_opposite_direction_enabled = match direction {
                RateLimitDirection::Outbound => is_inbound_enabled,
                RateLimitDirection::Inbound => is_outbound_enabled,
            };

            if is_opposite_direction_enabled {
                let opposite_direction_entry = match direction {
                    RateLimitDirection::Outbound => self.RateLimiter_inbound_rate_limits.entry(eid),
                    RateLimitDirection::Inbound => self.RateLimiter_outbound_rate_limits.entry(eid),
                };

                let rate_limit = opposite_direction_entry.read();

                // First apply the decay to get current amount in flight, THEN subtract the flow
                let FlowableAmount {
                    amount_in_flight: decayed_amount, flowable_amount: _,
                } = Self::_get_flowable_amount(@self, @rate_limit);
                let amount_in_flight = decayed_amount.saturating_sub(amount);

                opposite_direction_entry
                    .write(
                        RateLimit {
                            amount_in_flight: amount_in_flight.try_into().unwrap(),
                            last_updated: get_block_timestamp(),
                            ..rate_limit,
                        },
                    );
            }
        }

        /// Increases the amount in flight by the given amount.
        ///
        /// It verifies whether the specified amount falls within the rate limit constraints
        /// for the destination endpoint ID. On successful verification, it updates the
        /// amount in flight and the last-updated timestamp. If the amount exceeds the rate limit,
        /// the operation reverts.
        ///
        /// * `dst_eid` The destination endpoint ID.
        /// * `amount` The amount to outflow.
        fn _outflow(
            ref self: ComponentState<TContractState>, dst_eid: u32, amount: u256,
        ) {
            Self::_check_and_update_rate_limit(
                ref self, dst_eid, amount, RateLimitDirection::Outbound,
            );
        }

        /// Checks and updates the inbound rate limit.
        ///
        /// It verifies whether the specified amount falls within the inbound rate limit constraints
        /// for the source endpoint ID. On successful verification, it updates the
        /// amount in flight and the last-updated timestamp. If the amount exceeds the rate limit,
        /// the operation reverts.
        ///
        /// # Arguments
        /// * `src_eid` - The source endpoint ID.
        /// * `amount` - The amount to inflow.
        fn _inflow(
            ref self: ComponentState<TContractState>, src_eid: u32, amount: u256,
        ) {
            Self::_check_and_update_rate_limit(
                ref self, src_eid, amount, RateLimitDirection::Inbound,
            );
        }

        /// Checkpoints the rate limit state, updating both outbound and inbound with decayed
        /// values.
        ///
        /// This is called before updating rate limit configurations to preserve the current
        /// amount_in_flight with the old rate parameters before applying new ones.
        ///
        /// # Arguments
        /// * `eid` - The endpoint ID.
        fn _checkpoint_rate_limit(
            ref self: ComponentState<TContractState>, eid: u32,
        ) {
            let timestamp = get_block_timestamp();

            // Checkpoint outbound
            let outbound_entry = self.RateLimiter_outbound_rate_limits.entry(eid);
            let outbound_limit = outbound_entry.read();
            let FlowableAmount {
                amount_in_flight: outbound_in_flight, flowable_amount: _,
            } = Self::_get_flowable_amount(@self, @outbound_limit);
            outbound_entry
                .write(
                    RateLimit {
                        amount_in_flight: outbound_in_flight.try_into().unwrap(),
                        last_updated: timestamp,
                        ..outbound_limit,
                    },
                );

            // Checkpoint inbound
            let inbound_entry = self.RateLimiter_inbound_rate_limits.entry(eid);
            let inbound_limit = inbound_entry.read();
            let FlowableAmount {
                amount_in_flight: inbound_in_flight, flowable_amount: _,
            } = Self::_get_flowable_amount(@self, @inbound_limit);
            inbound_entry
                .write(
                    RateLimit {
                        amount_in_flight: inbound_in_flight.try_into().unwrap(),
                        last_updated: timestamp,
                        ..inbound_limit,
                    },
                );
        }

        /// Sets the rate limits.
        ///
        /// # Arguments
        /// * `configs` - Rate limit configurations.
        fn _set_rate_limits(
            ref self: ComponentState<TContractState>,
            configs: Array<RateLimitConfig>,
            direction: RateLimitDirection,
        ) {
            for config in @configs {
                // Update usages with old slopes before setting new limits and windows.
                // This updates BOTH outbound and inbound directions, matching EVM behavior.
                Self::_checkpoint_rate_limit(ref self, *config.dst_eid);

                let entry = match direction {
                    RateLimitDirection::Outbound => self
                        .RateLimiter_outbound_rate_limits
                        .entry(*config.dst_eid),
                    RateLimitDirection::Inbound => self
                        .RateLimiter_inbound_rate_limits
                        .entry(*config.dst_eid),
                };
                // Do NOT reset the `amount_in_flight` or `last_updated` of the existing
                // rate limit.
                entry
                    .write(
                        RateLimit { limit: *config.limit, window: *config.window, ..entry.read() },
                    );
            }

            self.emit(RateLimitsChanged { configs, direction });
        }


        /// Resets the outbound and inbound rate limits (sets `amount_in_flight` to 0) for the given
        /// endpoint IDs.
        ///
        /// # Arguments
        /// * `eids` - The endpoint IDs to reset the rate limits for.
        fn _reset_rate_limits(
            ref self: ComponentState<TContractState>, eids: Array<u32>,
        ) {
            for eid in @eids {
                let entry = self.RateLimiter_outbound_rate_limits.entry(*eid);
                entry
                    .write(
                        RateLimit {
                            amount_in_flight: 0,
                            last_updated: get_block_timestamp(),
                            ..entry.read(),
                        },
                    );

                let entry = self.RateLimiter_inbound_rate_limits.entry(*eid);
                entry
                    .write(
                        RateLimit {
                            amount_in_flight: 0,
                            last_updated: get_block_timestamp(),
                            ..entry.read(),
                        },
                    );
            }

            self.emit(RateLimitsReset { eids });
        }

        fn _set_rate_limit_enabled(
            ref self: ComponentState<TContractState>, enabled: RateLimitEnabled,
        ) {
            self.RateLimiter_enabled.write(enabled);
            self.emit(RateLimitEnabledChanged { rate_limit_enabled: enabled });
        }
    }

    #[embeddable_as(RateLimiterImpl)]
    impl RateLimiter<
        TContractState, +HasComponent<TContractState>, +RateLimiterHooks<TContractState>,
    > of IRateLimiter<ComponentState<TContractState>> {
        fn get_sendable_amount(
            self: @ComponentState<TContractState>, dst_eid: u32,
        ) -> SendableAmount {
            let FlowableAmount {
                amount_in_flight, flowable_amount,
            } = self._get_flowable_amount(@self.RateLimiter_outbound_rate_limits.read(dst_eid));
            SendableAmount { amount_in_flight, sendable_amount: flowable_amount }
        }

        fn get_receivable_amount(
            self: @ComponentState<TContractState>, src_eid: u32,
        ) -> ReceivableAmount {
            let FlowableAmount {
                amount_in_flight, flowable_amount,
            } = self._get_flowable_amount(@self.RateLimiter_inbound_rate_limits.read(src_eid));
            ReceivableAmount { amount_in_flight, receivable_amount: flowable_amount }
        }

        fn get_outbound_rate_limit(
            self: @ComponentState<TContractState>, dst_eid: u32,
        ) -> RateLimit {
            self.RateLimiter_outbound_rate_limits.read(dst_eid)
        }

        fn get_inbound_rate_limit(
            self: @ComponentState<TContractState>, src_eid: u32,
        ) -> RateLimit {
            self.RateLimiter_inbound_rate_limits.read(src_eid)
        }

        fn get_rate_limit_enabled(self: @ComponentState<TContractState>) -> RateLimitEnabled {
            self.RateLimiter_enabled.read()
        }
    }
}

pub impl RateLimiterHooksDefaultImpl<
    TContractState, +RateLimiterComponent::HasComponent<TContractState>,
> of RateLimiterComponent::RateLimiterHooks<TContractState> {}
