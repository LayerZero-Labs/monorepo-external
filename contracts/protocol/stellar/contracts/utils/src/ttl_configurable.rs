use crate::{self as utils, auth::Auth, errors::TtlConfigurableError};
use common_macros::{contract_trait, only_auth, storage};
use soroban_sdk::{assert_with_error, contractevent, contracttype, Env, IntoVal, Val};

/// Ledgers per day (~5 second close time).
pub const LEDGERS_PER_DAY: u32 = (24 * 3600) / 5;

/// Maximum TTL (1 year) allowed by the protocol.
/// Note: Stellar's current maximum TTL is 6 months, but this constraint may change
/// in the future. In order to preserve LayerZero's censorship-resistance and protect
/// users from abusive parameter changes, a constant upper bound is enforced on the
/// extend_to value.
pub const MAX_TTL: u32 = 365 * LEDGERS_PER_DAY;

/// TTL configuration: threshold (when to extend) and extend_to (target TTL).
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TtlConfig {
    /// TTL threshold that triggers extension (in ledgers).
    pub threshold: u32,
    /// Target TTL after extension (in ledgers).
    pub extend_to: u32,
}

impl TtlConfig {
    /// Creates a new TTL config.
    pub const fn new(threshold: u32, extend_to: u32) -> Self {
        Self { threshold, extend_to }
    }

    /// Validates that threshold <= extend_to <= max_ttl.
    pub fn is_valid(&self, max_ttl: u32) -> bool {
        self.threshold <= self.extend_to && self.extend_to <= max_ttl
    }
}

// =============================================================================
// Events
// =============================================================================

/// Event emitted when TTL configs are set.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TtlConfigsSet {
    pub instance: Option<TtlConfig>,
    pub persistent: Option<TtlConfig>,
}

/// Event emitted when TTL configs are frozen.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TtlConfigsFrozen {}

// =============================================================================
// Storage for default implementation
// =============================================================================

/// Storage keys for TTL configuration.
///
/// Note: Auto-TTL extension is disabled for these instance storage entries to avoid infinite
/// recursion. Extending TTL config storage would require reading the TTL config, which would
/// trigger another extension, creating a deep loop.
#[storage]
pub enum TtlConfigStorage {
    #[instance(bool)]
    #[default(false)]
    Frozen,

    #[instance(TtlConfig)]
    Instance,

    #[instance(TtlConfig)]
    Persistent,
}

/// Initializes TTL configs with the default values (threshold: 29 days, extend_to: 30 days).
///
/// This sets both instance and persistent TTL configs to `DEFAULT_TTL_CONFIG`.
pub fn init_default_ttl_configs(env: &Env) {
    let default_ttl_config = TtlConfig::new(29 * LEDGERS_PER_DAY, 30 * LEDGERS_PER_DAY);
    TtlConfigStorage::set_instance(env, &default_ttl_config);
    TtlConfigStorage::set_persistent(env, &default_ttl_config);
}

/// Extends instance storage TTL using the configured settings (if any).
pub fn extend_instance_ttl(env: &Env) {
    if let Some(TtlConfig { threshold, extend_to }) = TtlConfigStorage::instance(env) {
        env.storage().instance().extend_ttl(threshold, extend_to);
    }
}

/// Extends persistent storage TTL for a key using the configured settings (if any).
pub fn extend_persistent_ttl<K: IntoVal<Env, Val>>(env: &Env, key: &K) {
    if let Some(TtlConfig { threshold, extend_to }) = TtlConfigStorage::persistent(env) {
        env.storage().persistent().extend_ttl(key, threshold, extend_to);
    }
}

/// Trait for contracts that support configurable TTL (Time-To-Live) management.
///
/// Allows the contract authorizer to configure how long instance and persistent storage entries
/// remain alive on Stellar.
///
/// The authorizer can also permanently freeze the configuration to prevent future changes,
/// providing immutability guarantees to users.
///
/// Requires the `Auth` trait to be implemented, which can be provided by either:
/// - `#[ownable]` macro for single-owner contracts
/// - `#[multisig]` macro for multisig-controlled contracts
#[contract_trait]
pub trait TtlConfigurable: Auth {
    /// Sets TTL configs for instance and persistent storage.
    ///
    /// - `None` values remove the corresponding config (disables auto-extension for that type)
    /// - Validates that `threshold <= extend_to <= MAX_TTL`
    ///
    /// # Arguments
    /// - `instance` - TTL config for instance storage
    /// - `persistent` - TTL config for persistent storage
    ///
    /// # Panics
    /// - `TtlConfigFrozen` if configs are frozen
    /// - `InvalidTtlConfig` if validation fails
    #[only_auth]
    fn set_ttl_configs(
        env: &soroban_sdk::Env,
        instance: &Option<utils::ttl_configurable::TtlConfig>,
        persistent: &Option<utils::ttl_configurable::TtlConfig>,
    ) {
        assert_with_error!(env, !Self::is_ttl_configs_frozen(env), TtlConfigurableError::TtlConfigFrozen);

        let max_ttl = MAX_TTL.min(env.storage().max_ttl());
        let all_valid = [instance, persistent].iter().all(|c| c.is_none_or(|cfg| cfg.is_valid(max_ttl)));
        assert_with_error!(env, all_valid, TtlConfigurableError::InvalidTtlConfig);

        TtlConfigStorage::set_or_remove_instance(env, instance);
        TtlConfigStorage::set_or_remove_persistent(env, persistent);

        TtlConfigsSet { instance: *instance, persistent: *persistent }.publish(env);
    }

    /// Returns the current TTL configs as (instance_config, persistent_config).
    fn ttl_configs(
        env: &soroban_sdk::Env,
    ) -> (Option<utils::ttl_configurable::TtlConfig>, Option<utils::ttl_configurable::TtlConfig>) {
        (TtlConfigStorage::instance(env), TtlConfigStorage::persistent(env))
    }

    /// Permanently freezes TTL configs, preventing any future modifications.
    ///
    /// This is irreversible and provides immutability guarantees to users.
    /// Emits `TtlConfigsFrozen` event.
    ///
    /// # Panics
    /// - `TtlConfigAlreadyFrozen` if already frozen
    #[only_auth]
    fn freeze_ttl_configs(env: &soroban_sdk::Env) {
        assert_with_error!(env, !Self::is_ttl_configs_frozen(env), TtlConfigurableError::TtlConfigAlreadyFrozen);

        TtlConfigStorage::set_frozen(env, &true);

        TtlConfigsFrozen {}.publish(env);
    }

    /// Returns whether TTL configs are frozen.
    fn is_ttl_configs_frozen(env: &soroban_sdk::Env) -> bool {
        TtlConfigStorage::frozen(env)
    }
}
