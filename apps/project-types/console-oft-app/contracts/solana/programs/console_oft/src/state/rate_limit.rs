use super::IntoU128BeBytes;
use crate::{
    errors::OFTError,
    seeds::{RATE_LIMIT_EXEMPTION_SEED, RATE_LIMIT_SEED},
    OFTStore,
};
use anchor_lang::prelude::*;

pub const DEFAULT_RATE_LIMIT_ID: u128 = 0;

/// RateLimit PDA (config + state) for id=0 default and per-EID ids.
/// EVM alignment: `mapping(uint256 id => RateLimit) rateLimits` in RateLimiterBaseUpgradeable.sol
///
/// The default (eid=0) RateLimit lives in its own PDA. Per-EID config falls back to
/// the default PDA when `override_default_config=false`.
/// PDA seeds: [RATE_LIMIT_SEED, oft_store.key(), id.to_u128_be_bytes()] (16-byte big-endian u128)
#[account]
#[derive(Default, InitSpace)]
pub struct RateLimit {
    pub config: RateLimitConfig,
    pub state: RateLimitState,
}

impl RateLimit {
    /// PDA seeds for the per-eid rate limit.
    pub fn seeds<I: IntoU128BeBytes>(oft_store: &Pubkey, id: I) -> &'static [&'static [u8]] {
        let key_bytes: &'static [u8; 32] = Box::leak(Box::new(oft_store.to_bytes()));
        let id_bytes: &'static [u8; 16] = Box::leak(Box::new(id.to_u128_be_bytes()));
        Box::leak(Box::new([RATE_LIMIT_SEED, key_bytes.as_slice(), id_bytes.as_slice()]))
    }
}

/// Rate limit address exemption PDA.
/// Account existence indicates the user is exempt from rate limiting.
/// PDA seeds: [RATE_LIMIT_EXEMPTION_SEED, oft_store.key(), user.key()]
///
/// `initialized` lets the account constraint reject idempotent calls with
/// `ExemptionStateIdempotent` — mirroring EVM `_setRateLimitAddressExemptions`.
/// A freshly created PDA (via `init_if_needed`) is zero-initialized
/// (`initialized == false`); the handler sets it to `true` on grant and closes
/// the PDA on revoke, keeping existence and `initialized` aligned.
#[account]
#[derive(Default, InitSpace)]
pub struct RateLimitAddressExemption {
    pub initialized: bool,
}

impl RateLimitAddressExemption {
    /// PDA seeds for the per-user rate-limit address exemption.
    pub fn seeds(oft_store: &Pubkey, user: &Pubkey) -> &'static [&'static [u8]] {
        let key_bytes: &'static [u8; 32] = Box::leak(Box::new(oft_store.to_bytes()));
        let user_bytes: &'static [u8; 32] = Box::leak(Box::new(user.to_bytes()));
        Box::leak(Box::new([
            RATE_LIMIT_EXEMPTION_SEED,
            key_bytes.as_slice(),
            user_bytes.as_slice(),
        ]))
    }
}

// ================================ Composing State Types ================================

#[derive(Clone, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct RateLimitConfig {
    /// If false, config from eid=0 RateLimit is used. Ignored on eid=0.
    /// Reference: RateLimiterUtils.sol - OVERRIDE_DEFAULT_CONFIG_BIT
    pub override_default_config: bool,
    pub outbound_enabled: bool,
    pub inbound_enabled: bool,
    pub net_accounting_enabled: bool,
    pub address_exemption_enabled: bool,
    pub outbound_limit: u64,
    pub inbound_limit: u64,
    pub outbound_window: u64,
    pub inbound_window: u64,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            override_default_config: false,
            outbound_enabled: true,
            inbound_enabled: true,
            net_accounting_enabled: true,
            address_exemption_enabled: false,
            outbound_limit: 0,
            inbound_limit: 0,
            outbound_window: 0,
            inbound_window: 0,
        }
    }
}

impl RateLimitConfig {
    /// An outbound send applies no rate limiting and touches no state: outbound is
    /// disabled and there is no inbound net-accounting credit to write (inbound off or
    /// net accounting off). Mirrors the early-return gate in `apply_rate_limit`.
    fn outbound_skips_state(&self) -> bool {
        !self.outbound_enabled && (!self.inbound_enabled || !self.net_accounting_enabled)
    }

    /// Inbound mirror of [`Self::outbound_skips_state`].
    fn inbound_skips_state(&self) -> bool {
        !self.inbound_enabled && (!self.outbound_enabled || !self.net_accounting_enabled)
    }

    fn skips_state(&self, is_outflow: bool, is_address_exempt: bool) -> bool {
        (if is_outflow { self.outbound_skips_state() } else { self.inbound_skips_state() })
            || (self.address_exemption_enabled && is_address_exempt)
    }
}

#[derive(Default, Clone, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct RateLimitState {
    /// Current usage of the outbound rate limit.
    /// Reference: IRateLimiter.sol - RateLimit.outboundUsage
    pub outbound_usage: u64,
    /// Current usage of the inbound rate limit.
    /// Reference: IRateLimiter.sol - RateLimit.inboundUsage
    pub inbound_usage: u64,
    /// Timestamp of the last rate limit update (seconds).
    /// Reference: IRateLimiter.sol - RateLimit.lastUpdated
    pub last_updated: u64,
}

// ================================ View Return Types ================================

/// Global configuration for the rate limiter.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RateLimitGlobalConfig {
    /// Whether to use global state for the rate limiter, instead of per-ID rules.
    pub use_global_state: bool,
    /// Whether the rate limiter is globally disabled.
    pub is_globally_disabled: bool,
}

/// Decayed usages and available capacities for a rate limit.
/// If a rate limit is disabled in a given direction, the available amount is `u64::MAX`.
#[derive(Default, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RateLimitUsages {
    /// Current decayed usage of the outbound rate limit.
    pub outbound_usage: u64,
    /// Available capacity of the outbound rate limit.
    pub outbound_available: u64,
    /// Current decayed usage of the inbound rate limit.
    pub inbound_usage: u64,
    /// Available capacity of the inbound rate limit.
    pub inbound_available: u64,
}

impl RateLimitUsages {
    /// Zero usage with unlimited capacity for requests without state.
    fn unlimited() -> Self {
        Self {
            outbound_usage: 0,
            outbound_available: u64::MAX,
            inbound_usage: 0,
            inbound_available: u64::MAX,
        }
    }
}

// ================================ Rate Limiter Logic ================================
/// Calculates decayed usage and remaining capacity for a single direction.
///
/// # Reference
/// Based on `_getRateLimitUsage` in RateLimiterBaseUpgradeable.sol
/// ```solidity
/// function _getRateLimitUsage(
///     uint40 _lastUpdated, uint96 _amountInFlight, uint96 _limit, uint32 _window
/// ) returns (uint256 currentUsage, uint256 availableAmount) {
///     uint256 timeSinceLastUpdate = block.timestamp - _lastUpdated;
///     uint256 decay = (_limit * timeSinceLastUpdate) / (_window > 0 ? _window : 1);
///     currentUsage = Math.saturatingSub(_amountInFlight, decay);
///     availableAmount = Math.saturatingSub(_limit, currentUsage);
/// }
/// ```
fn compute_rate_limit_usage_at(
    last_updated: u64,
    amount_in_flight: u64,
    limit: u64,
    window: u64,
    now: u64,
) -> Result<(u64, u64)> {
    let elapsed = now.checked_sub(last_updated).ok_or(OFTError::LastUpdatedInFuture)?;
    let window = if window > 0 { window } else { 1 };
    let decay = u128::from(limit).saturating_mul(u128::from(elapsed)) / u128::from(window);
    let current_usage = u64::try_from(u128::from(amount_in_flight).saturating_sub(decay))?;
    let available = limit.saturating_sub(current_usage);
    Ok((current_usage, available))
}

/// Calculates decayed usages for both directions at the provided time.
/// Reference: `_getRateLimitUsages` in RateLimiterBaseUpgradeable.sol
pub(crate) fn compute_rate_limit_usages_at(
    state: &RateLimitState,
    config: &RateLimitConfig,
    now: u64,
) -> Result<RateLimitUsages> {
    let (outbound_usage, outbound_available) = compute_rate_limit_usage_at(
        state.last_updated,
        state.outbound_usage,
        config.outbound_limit,
        config.outbound_window,
        now,
    )?;
    let (inbound_usage, inbound_available) = compute_rate_limit_usage_at(
        state.last_updated,
        state.inbound_usage,
        config.inbound_limit,
        config.inbound_window,
        now,
    )?;
    Ok(RateLimitUsages { outbound_usage, outbound_available, inbound_usage, inbound_available })
}

/// Calculates decayed usages for both directions at the current time.
pub fn compute_rate_limit_usages(
    state: &RateLimitState,
    config: &RateLimitConfig,
) -> Result<RateLimitUsages> {
    compute_rate_limit_usages_at(state, config, now()?)
}

pub(crate) fn now() -> Result<u64> {
    Clock::get()?
        .unix_timestamp
        .try_into()
        .map_err(|_| OFTError::InvalidTimestamp.into())
}

// ================================ Config Resolution ================================

/// Returns effective config: per-EID's own config if override_default_config, else the
/// default from the id=0 RateLimit PDA. Reference: `_getRateLimitStateAndConfig` in
/// RateLimiterBaseUpgradeable.sol
fn get_effective_config<'a>(
    default_rate_limit: &'a RateLimit,
    rate_limit: &'a RateLimit,
) -> &'a RateLimitConfig {
    if rate_limit.config.override_default_config {
        &rate_limit.config
    } else {
        &default_rate_limit.config
    }
}

// ================================ Read API ================================

/// Gets current usages and available capacities for both directions.
/// Behavior:
/// - `outbound_available` and/or `inbound_available` are `u64::MAX` when disabled
/// - when globally disabled, both availabilities are `u64::MAX`, but usage values still reflect
///   decayed on-chain state when state exists; missing state returns zero usages
///
/// In per-EID state mode, a missing PDA returns `RateLimitNotInitialized` unless
/// rate limiting is globally disabled or both directions need no state. Address
/// exemptions are not considered because this view has no user argument, so an
/// exempt send may still succeed.
///
/// Reference: `getRateLimitUsages` in RateLimiterBaseUpgradeable.sol
pub fn get_rate_limit_usages(
    oft_store: &OFTStore,
    default_rate_limit: &RateLimit,
    rate_limit: Option<&RateLimit>,
) -> Result<RateLimitUsages> {
    let (state, config) =
        get_effective_state_and_config(oft_store.use_global_state, default_rate_limit, rate_limit);

    // Missing state is valid when globally disabled or both directions bypass state.
    let Some(state) = state else {
        require!(
            oft_store.is_globally_disabled
                || (config.outbound_skips_state() && config.inbound_skips_state()),
            OFTError::RateLimitNotInitialized
        );
        return Ok(RateLimitUsages::unlimited());
    };

    let mut usages = compute_rate_limit_usages(state, &config)?;
    if oft_store.is_globally_disabled {
        usages.outbound_available = u64::MAX;
        usages.inbound_available = u64::MAX;
    } else {
        if !config.outbound_enabled {
            usages.outbound_available = u64::MAX;
        }
        if !config.inbound_enabled {
            usages.inbound_available = u64::MAX;
        }
    }

    Ok(usages)
}

/// Returns outbound availability for `quote_oft`.
///
/// `quote_oft` is a send-side view: it only needs the amount that an outbound
/// send could pass through. That is narrower than `get_rate_limit_usages`, which
/// reports both directions.
///
/// A missing per-EID PDA is allowed only when a normal outbound send would not
/// touch state. If net accounting needs to update inbound usage, quote returns
/// `RateLimitNotInitialized` just as send does.
///
/// Address exemptions are not considered because this view has no user
/// argument. An exempt send may therefore succeed even when this view returns
/// `RateLimitNotInitialized`.
pub fn get_outbound_available_for_quote(
    oft_store: &OFTStore,
    default_rate_limit: &RateLimit,
    rate_limit: Option<&RateLimit>,
) -> Result<u64> {
    if oft_store.is_globally_disabled {
        return Ok(u64::MAX);
    }

    let (state, config) =
        get_effective_state_and_config(oft_store.use_global_state, default_rate_limit, rate_limit);

    // A missing per-EID PDA is fine only when the real send would also skip state;
    // otherwise net accounting still needs it, so treat it as uninitialized.
    let Some(state) = state else {
        require!(config.outbound_skips_state(), OFTError::RateLimitNotInitialized);
        return Ok(u64::MAX);
    };

    // Outbound is off, so a send is never blocked by it -> unlimited. Keep this below the
    // None check: a missing per-EID PDA can still be an error even when outbound is off.
    if !config.outbound_enabled {
        return Ok(u64::MAX);
    }

    Ok(compute_rate_limit_usages(state, &config)?.outbound_available)
}

// ================================ Write API ================================

/// Applies outflow rate limiting with global/per-EID fallback.
pub fn outflow(
    oft_store: &OFTStore,
    default_rate_limit: &mut RateLimit,
    rate_limit: Option<&mut RateLimit>,
    amount: u64,
    is_address_exempt: bool,
) -> Result<()> {
    let use_global_state = oft_store.use_global_state;
    let is_globally_disabled = oft_store.is_globally_disabled;
    apply_rate_limit(
        use_global_state,
        is_globally_disabled,
        default_rate_limit,
        rate_limit,
        amount,
        true,
        is_address_exempt,
    )
}

/// Applies inflow rate limiting with global/per-EID fallback.
pub fn inflow(
    oft_store: &OFTStore,
    default_rate_limit: &mut RateLimit,
    rate_limit: Option<&mut RateLimit>,
    amount: u64,
    is_address_exempt: bool,
) -> Result<()> {
    let use_global_state = oft_store.use_global_state;
    let is_globally_disabled = oft_store.is_globally_disabled;
    apply_rate_limit(
        use_global_state,
        is_globally_disabled,
        default_rate_limit,
        rate_limit,
        amount,
        false,
        is_address_exempt,
    )
}

/// Resolves effective state + config, mirroring EVM `_getRateLimitStateAndConfig`.
/// - use_global_state=true: state=config=default (from id=0 RateLimit PDA)
/// - use_global_state=false: state=per-EID; config=per-EID when override_default_config, else
///   default (from id=0 RateLimit PDA)
fn get_effective_state_and_config_mut<'a>(
    use_global_state: bool,
    default_rate_limit: &'a mut RateLimit,
    rate_limit: Option<&'a mut RateLimit>,
) -> (Option<&'a mut RateLimitState>, RateLimitConfig) {
    match (use_global_state, rate_limit) {
        (true, _) => (Some(&mut default_rate_limit.state), default_rate_limit.config.clone()),
        (false, Some(rate_limit)) => {
            let config = get_effective_config(default_rate_limit, rate_limit).clone();
            (Some(&mut rate_limit.state), config)
        },
        (false, None) => (None, default_rate_limit.config.clone()),
    }
}

/// Read-only variant of rate-limit state/config resolution.
fn get_effective_state_and_config<'a>(
    use_global_state: bool,
    default_rate_limit: &'a RateLimit,
    rate_limit: Option<&'a RateLimit>,
) -> (Option<&'a RateLimitState>, RateLimitConfig) {
    match (use_global_state, rate_limit) {
        (true, _) => (Some(&default_rate_limit.state), default_rate_limit.config.clone()),
        (false, Some(rate_limit)) => {
            let config = get_effective_config(default_rate_limit, rate_limit).clone();
            (Some(&rate_limit.state), config)
        },
        (false, None) => (None, default_rate_limit.config.clone()),
    }
}

/// Resolves global vs per-EID state/config, then delegates to core apply logic.
/// Reference: `_applyRateLimit` in RateLimiterBaseUpgradeable.sol
fn apply_rate_limit(
    use_global_state: bool,
    is_globally_disabled: bool,
    default_rate_limit: &mut RateLimit,
    rate_limit: Option<&mut RateLimit>,
    amount: u64,
    is_outflow: bool,
    is_address_exempt: bool,
) -> Result<()> {
    // EVM parity: `_applyRateLimit` returns early when globally disabled.
    if is_globally_disabled {
        return Ok(());
    }

    let (state, config) =
        get_effective_state_and_config_mut(use_global_state, default_rate_limit, rate_limit);

    // No-op paths must not require state or read the clock.
    if config.skips_state(is_outflow, is_address_exempt) {
        return Ok(());
    }
    let state = state.ok_or(OFTError::RateLimitNotInitialized)?;
    apply_rate_limit_to_state(state, &config, amount, is_outflow, is_address_exempt, now()?)
}

/// Applies one transfer of `amount` to `state` as of `now`. Errors leave `state` unchanged.
fn apply_rate_limit_to_state(
    state: &mut RateLimitState,
    config: &RateLimitConfig,
    amount: u64,
    is_outflow: bool,
    is_address_exempt: bool,
    now: u64,
) -> Result<()> {
    let (mut forward_enabled, mut backward_enabled) =
        (config.outbound_enabled, config.inbound_enabled);
    if !is_outflow {
        (forward_enabled, backward_enabled) = (backward_enabled, forward_enabled);
    }
    let net_accounting_enabled = config.net_accounting_enabled;
    if config.skips_state(is_outflow, is_address_exempt) {
        return Ok(());
    }

    let usages = compute_rate_limit_usages_at(state, config, now)?;
    let (
        mut forward_usage,
        mut forward_available_amount,
        mut backward_usage,
        mut _backward_available_amount,
    ) = (
        usages.outbound_usage,
        usages.outbound_available,
        usages.inbound_usage,
        usages.inbound_available,
    );

    if !is_outflow {
        (forward_usage, forward_available_amount, backward_usage, _backward_available_amount) =
            (backward_usage, _backward_available_amount, forward_usage, forward_available_amount);
    }

    if forward_enabled {
        require!(forward_available_amount >= amount, OFTError::RateLimitExceeded);
        forward_usage = forward_usage.saturating_add(amount);
    }

    if backward_enabled && net_accounting_enabled {
        backward_usage = backward_usage.saturating_sub(amount);
    }

    (state.outbound_usage, state.inbound_usage) =
        if is_outflow { (forward_usage, backward_usage) } else { (backward_usage, forward_usage) };
    state.last_updated = now;

    Ok(())
}

// ===============================================================
// Tests
// ===============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn config(limit: u64, window: u64) -> RateLimitConfig {
        RateLimitConfig {
            override_default_config: false,
            outbound_enabled: true,
            inbound_enabled: true,
            net_accounting_enabled: true,
            address_exemption_enabled: false,
            outbound_limit: limit,
            inbound_limit: limit,
            outbound_window: window,
            inbound_window: window,
        }
    }

    fn usage(outbound_usage: u64, inbound_usage: u64, last_updated: u64) -> RateLimitState {
        RateLimitState { outbound_usage, inbound_usage, last_updated }
    }

    fn store(is_globally_disabled: bool) -> OFTStore {
        OFTStore {
            oft_type: oft::types::OftType::LockUnlock,
            ld2sd_rate: 1,
            shared_decimals: 6,
            token_mint: Pubkey::default(),
            initializer: Pubkey::default(),
            token_program: Pubkey::default(),
            bump: 0,
            transfer_hook_program: Pubkey::default(),
            acl_gating_program: Pubkey::default(),
            current_default_admin: Pubkey::default(),
            pending_default_admin: Pubkey::default(),
            default_paused: false,
            default_fee_bps: 0,
            fee_deposit: Pubkey::default(),
            use_global_state: false,
            is_globally_disabled,
            credit_redirect_config: None,
            pubkey_policy: None,
            token_manager: None,
        }
    }

    /// A transfer charges its own direction when enabled and, with net accounting, refunds the
    /// opposite direction when that is enabled.
    #[test]
    fn transfer_charges_its_direction_and_nets_the_opposite_one() {
        for is_outflow in [false, true] {
            for forward_enabled in [false, true] {
                for backward_enabled in [false, true] {
                    for net in [false, true] {
                        let mut config = config(100, 60);
                        (config.outbound_enabled, config.inbound_enabled) = if is_outflow {
                            (forward_enabled, backward_enabled)
                        } else {
                            (backward_enabled, forward_enabled)
                        };
                        config.net_accounting_enabled = net;
                        let mut state = usage(50, 50, 100);
                        apply_rate_limit_to_state(&mut state, &config, 20, is_outflow, false, 100)
                            .unwrap();
                        let (forward, backward) = if is_outflow {
                            (state.outbound_usage, state.inbound_usage)
                        } else {
                            (state.inbound_usage, state.outbound_usage)
                        };
                        assert_eq!(forward, if forward_enabled { 70 } else { 50 });
                        assert_eq!(backward, if backward_enabled && net { 30 } else { 50 });
                    }
                }
            }
        }
    }

    /// After half the window, half the limit has decayed and can be spent again, and no more.
    #[test]
    fn usage_decays_linearly_over_the_window() {
        let config = config(1_000, 60);
        let mut state = usage(1_000, 0, 0);
        apply_rate_limit_to_state(&mut state, &config, 500, true, false, 30).unwrap();
        assert_eq!((state.outbound_usage, state.last_updated), (1_000, 30));
        assert_eq!(
            apply_rate_limit_to_state(&mut state, &config, 1, true, false, 30),
            Err(OFTError::RateLimitExceeded.into())
        );
    }

    #[test]
    fn failed_transfers_leave_usage_and_timestamp_unchanged() {
        let config = config(100, 60);
        for is_outflow in [false, true] {
            for (amount, now, error) in
                [(1, 99, OFTError::LastUpdatedInFuture), (51, 100, OFTError::RateLimitExceeded)]
            {
                let mut state = usage(50, 50, 100);
                let before = borsh::to_vec(&state).unwrap();
                assert_eq!(
                    apply_rate_limit_to_state(&mut state, &config, amount, is_outflow, false, now),
                    Err(error.into())
                );
                assert_eq!(borsh::to_vec(&state).unwrap(), before);
            }
        }
    }

    #[test]
    fn zero_capacity_and_zero_window_boundaries() {
        for is_outflow in [false, true] {
            let zero = config(0, 0);
            let mut state = RateLimitState::default();
            apply_rate_limit_to_state(&mut state, &zero, 0, is_outflow, false, 1).unwrap();
            assert_eq!(
                apply_rate_limit_to_state(&mut state, &zero, 1, is_outflow, false, 1),
                Err(OFTError::RateLimitExceeded.into())
            );
            // A zero window decays like a one-second window.
            let mut state = usage(100, 100, 0);
            apply_rate_limit_to_state(&mut state, &config(100, 0), 100, is_outflow, false, 1)
                .unwrap();
            assert_eq!(
                (state.outbound_usage, state.inbound_usage),
                if is_outflow { (100, 0) } else { (0, 100) }
            );
        }
    }

    /// Transfers with nothing to charge or refund — exempt addresses (when exemption is
    /// enabled) and directions whose limit and net credit are both off — neither need a per-EID
    /// state nor touch one, even when they exceed every limit.
    #[test]
    fn transfers_with_nothing_to_charge_need_and_touch_no_state() {
        let exempt = RateLimitConfig { address_exemption_enabled: true, ..config(100, 60) };
        let outbound_off = RateLimitConfig {
            outbound_enabled: false,
            net_accounting_enabled: false,
            ..config(100, 60)
        };
        let inbound_off = RateLimitConfig {
            inbound_enabled: false,
            net_accounting_enabled: false,
            ..config(100, 60)
        };
        let both_off =
            RateLimitConfig { outbound_enabled: false, inbound_enabled: false, ..config(100, 60) };
        for (config, is_outflow, is_exempt) in [
            (exempt.clone(), true, true),
            (exempt, false, true),
            (outbound_off, true, false),
            (inbound_off, false, false),
            (both_off.clone(), true, false),
            (both_off, false, false),
        ] {
            let mut state = usage(50, 50, 7);
            apply_rate_limit_to_state(&mut state, &config, 500, is_outflow, is_exempt, 7).unwrap();
            assert_eq!(borsh::to_vec(&state).unwrap(), borsh::to_vec(&usage(50, 50, 7)).unwrap());

            let mut default = RateLimit { config, state: RateLimitState::default() };
            apply_rate_limit(false, false, &mut default, None, 500, is_outflow, is_exempt).unwrap();
        }
    }

    /// Exemption applies only while enabled; otherwise an exempt address is limited like any
    /// other, and a missing per-EID state is an error.
    #[test]
    fn exemption_is_ignored_while_disabled() {
        let mut default = RateLimit { config: config(100, 60), state: RateLimitState::default() };
        assert_eq!(
            apply_rate_limit(false, false, &mut default, None, 1, true, true),
            Err(OFTError::RateLimitNotInitialized.into())
        );
    }

    /// The views demand a per-EID state exactly when the transfer they describe would.
    #[test]
    fn views_require_per_eid_state_exactly_when_a_transfer_would() {
        let default = |config| RateLimit { config, state: RateLimitState::default() };
        // Send charges nothing and refunds nothing; receive still charges inbound.
        let send_free = RateLimitConfig {
            outbound_enabled: false,
            net_accounting_enabled: false,
            ..config(100, 60)
        };
        assert_eq!(
            get_outbound_available_for_quote(&store(false), &default(send_free.clone()), None),
            Ok(u64::MAX)
        );
        assert!(get_rate_limit_usages(&store(false), &default(send_free), None).is_err());
        // Send refunds inbound through net accounting, so it needs the state.
        let send_refunds = RateLimitConfig { outbound_enabled: false, ..config(100, 60) };
        assert_eq!(
            get_outbound_available_for_quote(&store(false), &default(send_refunds), None),
            Err(OFTError::RateLimitNotInitialized.into())
        );
        // Globally disabled: nothing is charged, so nothing is required.
        let usages = get_rate_limit_usages(&store(true), &default(config(100, 60)), None).unwrap();
        assert_eq!(
            (usages.outbound_available, usages.inbound_available, usages.outbound_usage),
            (u64::MAX, u64::MAX, 0)
        );
    }
}
