use crate::errors::Uln302Error;
use soroban_sdk::{assert_with_error, contracttype, map, vec, Address, Env, IntoVal, TryFromVal, Val, Vec};

/// Maximum number of DVNs allowed in a configuration.
pub const MAX_DVNS: u32 = 127;

// ============================================================================================
// ULN Config Types
// ============================================================================================

/// Ultra Light Node configuration for message verification.
#[contracttype]
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct UlnConfig {
    /// Number of block confirmations required before message verification begins.
    pub confirmations: u64,
    /// List of DVN addresses that must ALL verify the message (no threshold).
    pub required_dvns: Vec<Address>,
    /// List of DVN addresses from which a threshold number must verify.
    pub optional_dvns: Vec<Address>,
    /// Minimum number of optional DVNs required to verify.
    pub optional_dvn_threshold: u32,
}

impl UlnConfig {
    /// Creates a new UlnConfig with default values.
    pub fn default(env: &Env) -> Self {
        UlnConfig { confirmations: 0, required_dvns: vec![&env], optional_dvns: vec![&env], optional_dvn_threshold: 0 }
    }

    /// Validates a UlnConfig for using as a default config.
    ///
    /// Performs comprehensive validation including:
    /// - Required DVNs validation (no duplicates, within limits)
    /// - Optional DVNs validation (no duplicates, within limits, valid threshold)
    /// - At least one DVN requirement (either required or optional with threshold > 0)
    pub fn validate_default_config(&self, env: &Env) {
        self.validate_required_dvns(env);
        self.validate_optional_dvns(env);
        self.validate_at_least_one_dvn(env);
    }

    /// Validates the required DVNs configuration.
    ///
    /// Checks:
    /// - No duplicate addresses in the required DVNs list
    /// - Required DVNs count does not exceed MAX_DVNS limit
    pub fn validate_required_dvns(&self, env: &Env) {
        assert_with_error!(env, !has_duplicates(env, &self.required_dvns), Uln302Error::DuplicateRequiredDVNs);
        assert_with_error!(env, self.required_dvns.len() <= MAX_DVNS, Uln302Error::InvalidRequiredDVNCount);
    }

    /// Validates the optional DVNs configuration and threshold.
    ///
    /// Checks:
    /// - No duplicate addresses in the optional DVNs list
    /// - Optional DVNs count does not exceed MAX_DVNS limit
    /// - Threshold is valid: either (0 threshold with 0 DVNs) or (threshold between 1 and DVN count)
    pub fn validate_optional_dvns(&self, env: &Env) {
        assert_with_error!(env, !has_duplicates(env, &self.optional_dvns), Uln302Error::DuplicateOptionalDVNs);
        assert_with_error!(env, self.optional_dvns.len() <= MAX_DVNS, Uln302Error::InvalidOptionalDVNCount);
        assert_with_error!(
            env,
            (self.optional_dvn_threshold == 0 && self.optional_dvns.is_empty())
                || (self.optional_dvn_threshold > 0 && self.optional_dvn_threshold <= self.optional_dvns.len()),
            Uln302Error::InvalidOptionalDVNThreshold
        );
    }

    /// Validates that the configuration has at least one DVN for verification.
    ///
    /// A valid configuration must have either:
    /// - At least one required DVN, OR
    /// - An optional DVN threshold greater than 0
    pub fn validate_at_least_one_dvn(&self, env: &Env) {
        assert_with_error!(
            env,
            !self.required_dvns.is_empty() || self.optional_dvn_threshold > 0,
            Uln302Error::UlnAtLeastOneDVN
        );
    }
}

/// OApp-specific ULN configuration with default override flags.
#[contracttype]
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct OAppUlnConfig {
    /// Whether to use default confirmations.
    pub use_default_confirmations: bool,
    /// Whether to use default required DVNs.
    pub use_default_required_dvns: bool,
    /// Whether to use default optional DVNs.
    pub use_default_optional_dvns: bool,
    /// OApp-specific ULN configuration (used when defaults are not applied).
    pub uln_config: UlnConfig,
}

impl OAppUlnConfig {
    /// Creates a default OAppUlnConfig that uses all default values.
    pub fn default(env: &Env) -> Self {
        OAppUlnConfig {
            use_default_confirmations: true,
            use_default_required_dvns: true,
            use_default_optional_dvns: true,
            uln_config: UlnConfig::default(env),
        }
    }

    /// Validates an OAppUlnConfig for correctness.
    ///
    /// Checks:
    /// - When using defaults, corresponding config values must be empty/zero
    /// - When not using defaults, the provided values must be valid
    pub fn validate_oapp_config(&self, env: &Env) {
        if self.use_default_confirmations {
            assert_with_error!(env, self.uln_config.confirmations == 0, Uln302Error::InvalidConfirmations);
        }

        if self.use_default_required_dvns {
            assert_with_error!(env, self.uln_config.required_dvns.is_empty(), Uln302Error::InvalidRequiredDVNs);
        } else {
            self.uln_config.validate_required_dvns(env);
        }

        if self.use_default_optional_dvns {
            assert_with_error!(
                env,
                self.uln_config.optional_dvn_threshold == 0 && self.uln_config.optional_dvns.is_empty(),
                Uln302Error::InvalidOptionalDVNs
            );
        } else {
            self.uln_config.validate_optional_dvns(env);
        }
    }

    /// Merges this OAppUlnConfig with a default UlnConfig to produce the effective config.
    pub fn apply_default_config(&self, default_config: &UlnConfig) -> UlnConfig {
        let confirmations =
            if self.use_default_confirmations { default_config.confirmations } else { self.uln_config.confirmations };

        let required_dvns = if self.use_default_required_dvns {
            default_config.required_dvns.clone()
        } else {
            self.uln_config.required_dvns.clone()
        };

        let (optional_dvns, optional_dvn_threshold) = if self.use_default_optional_dvns {
            (default_config.optional_dvns.clone(), default_config.optional_dvn_threshold)
        } else {
            (self.uln_config.optional_dvns.clone(), self.uln_config.optional_dvn_threshold)
        };

        UlnConfig { confirmations, required_dvns, optional_dvns, optional_dvn_threshold }
    }
}

/// Parameter for setting default ULN configuration for a destination/source endpoint.
#[contracttype]
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct SetDefaultUlnConfigParam {
    /// The destination endpoint ID (for send) or source endpoint ID (for receive).
    pub eid: u32,
    /// The ULN configuration to set as default.
    pub config: UlnConfig,
}

// ============================================================================================
// Executor Config Types
// ============================================================================================

/// Executor configuration for message delivery.
#[contracttype]
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct ExecutorConfig {
    /// Maximum size of messages that can be executed (in bytes).
    pub max_message_size: u32,
    /// Address of the executor contract responsible for message execution.
    pub executor: Address,
}

impl ExecutorConfig {
    /// Validates the executor config for use as a default configuration.
    pub fn validate_default_config(&self, env: &Env) {
        assert_with_error!(env, self.max_message_size != 0, Uln302Error::ZeroMessageSize);
    }
}

/// OApp-specific executor configuration.
///
/// If executor is `None`, the default executor is used.
#[contracttype]
#[derive(Clone, Default, Eq, PartialEq, Debug)]
pub struct OAppExecutorConfig {
    /// Maximum size of messages that can be executed (in bytes). 0 means use default configuration.
    pub max_message_size: u32,
    /// Address of the executor contract to be used for message execution. None means use default configuration.
    pub executor: Option<Address>,
}

impl OAppExecutorConfig {
    /// Merges this OAppExecutorConfig with a default ExecutorConfig to produce the effective config.
    pub fn apply_default_config(&self, default_config: &ExecutorConfig) -> ExecutorConfig {
        ExecutorConfig {
            max_message_size: if self.max_message_size != 0 {
                self.max_message_size
            } else {
                default_config.max_message_size
            },
            executor: self.executor.clone().unwrap_or(default_config.executor.clone()),
        }
    }
}

/// Parameter for setting default executor configuration for a destination endpoint.
#[contracttype]
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct SetDefaultExecutorConfigParam {
    /// The destination endpoint ID.
    pub dst_eid: u32,
    /// The executor configuration to set as default.
    pub config: ExecutorConfig,
}

// ============================================================================================
// Helper Functions
// ============================================================================================

/// Checks if a vector contains duplicate elements.
fn has_duplicates<T>(env: &Env, items: &Vec<T>) -> bool
where
    T: IntoVal<Env, Val> + TryFromVal<Env, Val> + Clone,
{
    let mut seen = map![env];
    for item in items {
        if seen.contains_key(item.clone()) {
            return true;
        }
        seen.set(item, true);
    }
    false
}
