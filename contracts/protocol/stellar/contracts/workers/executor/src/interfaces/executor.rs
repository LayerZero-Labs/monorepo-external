use endpoint_v2::Origin;
use message_lib_common::interfaces::ILayerZeroExecutor;
use soroban_sdk::{contractclient, contracttype, Address, Env, Vec};
use worker::Worker;

/// Destination chain configuration for executor fee calculation.
///
/// Contains gas costs and fee parameters specific to each destination chain.
/// These parameters are used by the fee library to calculate accurate execution fees.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DstConfig {
    /// Base gas cost for lzReceive execution on the destination chain.
    pub lz_receive_base_gas: u64,
    /// Fee multiplier in basis points for this destination (0 = use default multiplier).
    pub multiplier_bps: u32,
    /// Minimum fee margin in USD (scaled) to ensure profitability.
    pub floor_margin_usd: u128,
    /// Maximum native token value that can be transferred to the destination.
    pub native_cap: u128,
    /// Base gas cost per lzCompose call on the destination chain.
    pub lz_compose_base_gas: u64,
}

/// Parameters for setting destination configuration.
///
/// Used when configuring executor settings for a specific destination chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetDstConfigParam {
    /// Destination endpoint ID (chain identifier).
    pub dst_eid: u32,
    /// Configuration for the destination chain.
    pub dst_config: DstConfig,
}

/// Parameters for a native token drop.
///
/// Used to specify native token transfers as part of executor options.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeDropParams {
    /// Receiver address for the native token transfer.
    pub receiver: Address,
    /// Amount of native tokens to transfer.
    pub amount: i128,
}

// ============================================================================
// IExecutor Trait
// ============================================================================

#[contractclient(name = "ExecutorClient")]
pub trait IExecutor: Worker + ILayerZeroExecutor {
    /// Sets destination-specific configurations for multiple endpoints.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must provide authorization)
    /// * `params` - Vector of (dst_eid, DstConfig) pairs to set
    fn set_dst_config(env: &Env, admin: &Address, params: &Vec<SetDstConfigParam>);

    /// Gets the destination configuration for a specific endpoint.
    ///
    /// # Arguments
    /// * `dst_eid` - Destination endpoint ID (chain identifier)
    ///
    /// # Returns
    /// The destination configuration, or `None` if not set
    fn dst_config(env: &Env, dst_eid: u32) -> Option<DstConfig>;

    /// Native token drops.
    ///
    /// Transfers native tokens to each receiver specified in the parameters and
    /// tracks the success/failure status of each transfer.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must provide authorization)
    /// * `origin` - Origin of the message
    /// * `dst_eid` - Destination endpoint ID (chain identifier)
    /// * `oapp` - OApp address
    /// * `native_drop_params` - Vector of (receiver, amount) pairs to transfer
    fn native_drop(
        env: &Env,
        admin: &Address,
        origin: &Origin,
        dst_eid: u32,
        oapp: &Address,
        native_drop_params: &Vec<NativeDropParams>,
    );

    /// Returns the endpoint address.
    fn endpoint(env: &Env) -> Address;
}
