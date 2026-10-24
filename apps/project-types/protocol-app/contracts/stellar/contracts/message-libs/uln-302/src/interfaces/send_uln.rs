pub use crate::types::{
    ExecutorConfig, OAppExecutorConfig, OAppUlnConfig, SetDefaultExecutorConfigParam, SetDefaultUlnConfigParam,
    UlnConfig,
};
use endpoint_v2::ISendLib;
use soroban_sdk::{contractclient, Address, Env, Vec};

// ============================================================================================
// ISendUln302 Trait
// ============================================================================================

/// Interface for ULN302 send library functions.
///
/// Extends `ISendLib` with ULN-specific configuration management for executors and DVNs.
#[contractclient(name = "SendUln302Client")]
pub trait ISendUln302: ISendLib {
    /// Returns the treasury address for fee collection.
    fn treasury(env: &Env) -> Address;

    /// Sets default executor configurations for multiple destination endpoints.
    ///
    /// # Arguments
    /// * `params` - A vector of `SetDefaultExecutorConfigParam`, each containing a destination EID and its executor config
    fn set_default_executor_configs(env: &Env, params: &Vec<SetDefaultExecutorConfigParam>);

    /// Returns the default executor configuration for a destination endpoint.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    fn default_executor_config(env: &Env, dst_eid: u32) -> Option<ExecutorConfig>;

    /// Returns the OApp-specific executor configuration for a specific destination endpoint.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    fn oapp_executor_config(env: &Env, sender: &Address, dst_eid: u32) -> Option<OAppExecutorConfig>;

    /// Gets the effective executor configuration (OApp config merged with default).
    ///
    /// Merges the OApp-specific config with the default config. OApp settings take precedence.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// The effective executor configuration
    ///
    /// # Panics
    /// Panics if the default executor configuration is not set for the destination endpoint.
    fn effective_executor_config(env: &Env, sender: &Address, dst_eid: u32) -> ExecutorConfig;

    /// Sets default send ULN configurations for multiple destination endpoints.
    ///
    /// # Arguments
    /// * `params` - A vector of `SetDefaultUlnConfigParam`, each containing a destination EID and its ULN config
    fn set_default_send_uln_configs(env: &Env, params: &Vec<SetDefaultUlnConfigParam>);

    /// Returns the default send ULN configuration for a destination endpoint.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    fn default_send_uln_config(env: &Env, dst_eid: u32) -> Option<UlnConfig>;

    /// Returns the OApp-specific send ULN configuration for a specific destination endpoint.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    fn oapp_send_uln_config(env: &Env, sender: &Address, dst_eid: u32) -> Option<OAppUlnConfig>;

    /// Gets the effective send ULN configuration (OApp config merged with default).
    ///
    /// Merges the OApp-specific config with the default config. OApp settings take precedence.
    ///
    /// # Arguments
    /// * `sender` - The sender OApp address
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// The effective send ULN configuration
    ///
    /// # Panics
    /// Panics if the default send ULN configuration is not set for the destination endpoint.
    fn effective_send_uln_config(env: &Env, sender: &Address, dst_eid: u32) -> UlnConfig;
}
