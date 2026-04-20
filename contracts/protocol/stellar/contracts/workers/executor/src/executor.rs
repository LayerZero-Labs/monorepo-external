use crate::{
    errors::ExecutorError,
    events::{DstConfigSet, NativeDropApplied},
    interfaces::{DstConfig, IExecutor, SetDstConfigParam},
    storage::ExecutorStorage,
    NativeDropParams,
};
use common_macros::{contract_impl, lz_contract, only_auth};
use endpoint_v2::{FeeRecipient, LayerZeroEndpointV2Client, Origin};
use fee_lib_interfaces::{ExecutorFeeLibClient, FeeParams};
use message_lib_common::interfaces::ILayerZeroExecutor;
use soroban_sdk::{token::TokenClient, vec, Address, Bytes, BytesN, Env, Symbol, Vec};
use utils::option_ext::OptionExt;
use worker::{
    assert_acl, assert_not_paused, assert_supported_message_lib, init_worker, require_admin_auth, Worker, WorkerError,
};

/// LayerZero Executor contract for cross-chain message execution.
#[lz_contract(upgradeable(no_migration))]
pub struct LzExecutor;

#[contract_impl]
impl LzExecutor {
    /// Initializes the executor contract.
    ///
    /// Sets up ownership, worker configuration, and endpoint address.
    ///
    /// # Arguments
    /// * `endpoint` - LayerZero Endpoint V2 contract address
    /// * `owner` - Contract owner address
    /// * `admins` - Initial admin addresses (must not be empty)
    /// * `message_libs` - Supported message library addresses (e.g., ULN302)
    /// * `price_feed` - Price feed contract address for fee calculations
    /// * `default_multiplier_bps` - Default fee multiplier in basis points (10000 = 1x)
    /// * `worker_fee_lib` - Worker fee library contract address
    /// * `deposit_address` - Address to receive fee payments
    pub fn __constructor(
        env: &Env,
        endpoint: &Address,
        owner: &Address,
        admins: &Vec<Address>,
        message_libs: &Vec<Address>,
        price_feed: &Address,
        default_multiplier_bps: u32,
        worker_fee_lib: &Address,
        deposit_address: &Address,
    ) {
        Self::init_owner(env, owner);
        init_worker::<Self>(
            env,
            admins,
            message_libs,
            price_feed,
            default_multiplier_bps,
            worker_fee_lib,
            deposit_address,
        );
        ExecutorStorage::set_endpoint(env, endpoint);
    }

    /// Withdraws a token from the contract to a specified address.
    ///
    /// # Arguments
    /// * `token` - The token contract address
    /// * `to` - The recipient address
    /// * `amount` - The amount to withdraw
    pub fn withdraw_token(env: &Env, admin: &Address, token: &Address, to: &Address, amount: i128) {
        require_admin_auth::<Self>(env, admin);
        TokenClient::new(env, token).transfer(&env.current_contract_address(), to, &amount);
    }

    /// Registers an executor helper contract with its allowed function names.
    ///
    /// The executor helper is an intermediary contract that calls `executor.require_auth()`
    /// before delegating to OApp functions. The registered address and function names are
    /// used by `validate_auth_contexts` to verify authorization contexts.
    ///
    /// # Arguments
    /// * `helper` - The executor helper contract address
    /// * `allowed_functions` - Function names the helper is allowed to invoke (e.g., "execute", "compose")
    #[only_auth]
    pub fn set_executor_helper(env: &Env, helper: &Address, allowed_functions: &Vec<Symbol>) {
        ExecutorStorage::set_executor_helper(
            env,
            &crate::storage::ExecutorHelperConfig {
                address: helper.clone(),
                allowed_functions: allowed_functions.clone(),
            },
        );
    }

    /// Returns the registered executor helper configuration.
    pub fn executor_helper(env: &Env) -> Option<crate::storage::ExecutorHelperConfig> {
        ExecutorStorage::executor_helper(env)
    }
}

// ============================================================================
// IExecutor implementation
// ============================================================================

#[contract_impl]
impl IExecutor for LzExecutor {
    /// Sets destination-specific configurations for multiple endpoints.
    fn set_dst_config(env: &Env, admin: &Address, params: &Vec<SetDstConfigParam>) {
        require_admin_auth::<Self>(env, admin);

        params.iter().for_each(|param| ExecutorStorage::set_dst_config(env, param.dst_eid, &param.dst_config));
        DstConfigSet { params: params.clone() }.publish(env);
    }

    /// Returns the destination configuration for a specific endpoint.
    fn dst_config(env: &Env, dst_eid: u32) -> Option<DstConfig> {
        ExecutorStorage::dst_config(env, dst_eid)
    }

    /// Native token drops.
    ///
    /// Transfers native tokens to each receiver specified in the parameters and
    /// tracks the success/failure status of each transfer.
    fn native_drop(
        env: &Env,
        admin: &Address,
        origin: &Origin,
        dst_eid: u32,
        oapp: &Address,
        native_drop_params: &Vec<NativeDropParams>,
    ) {
        require_admin_auth::<Self>(env, admin);

        let endpoint_client = LayerZeroEndpointV2Client::new(env, &Self::endpoint(env));
        let token_client = TokenClient::new(env, &endpoint_client.native_token());

        // Transfer native tokens from admin to each receiver and track success/failure
        let mut success = vec![env];
        native_drop_params.iter().for_each(|param| {
            success.push_back(token_client.try_transfer(admin, &param.receiver, &param.amount).is_ok())
        });

        // Emit event with transfer results
        NativeDropApplied {
            origin: origin.clone(),
            dst_eid,
            oapp: oapp.clone(),
            native_drop_params: native_drop_params.clone(),
            success,
        }
        .publish(env);
    }

    /// Returns the endpoint address from storage.
    fn endpoint(env: &Env) -> Address {
        ExecutorStorage::endpoint(env).unwrap()
    }
}

// ============================================================================
// ILayerZeroExecutor implementation (send-flow)
// ============================================================================

#[contract_impl]
impl ILayerZeroExecutor for LzExecutor {
    /// Assigns a job to the executor and returns fee recipient information.
    fn assign_job(
        env: &Env,
        send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        calldata_size: u32,
        options: &Bytes,
    ) -> FeeRecipient {
        send_lib.require_auth();
        assert_supported_message_lib::<Self>(env, send_lib);
        // `get_fee` already asserts not_paused and acl, so we don't need to do it here again

        let fee = Self::get_fee(env, send_lib, sender, dst_eid, calldata_size, options);
        let deposit_address = Self::deposit_address(env).unwrap_or_panic(env, WorkerError::DepositAddressNotSet);
        FeeRecipient { amount: fee, to: deposit_address }
    }

    /// Calculates the execution fee for a cross-chain message.
    fn get_fee(
        env: &Env,
        _send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        calldata_size: u32,
        options: &Bytes,
    ) -> i128 {
        assert_not_paused::<Self>(env);
        assert_acl::<Self>(env, sender);

        let dst_config = Self::dst_config(env, dst_eid).unwrap_or_panic(env, ExecutorError::EidNotSupported);
        let price_feed = Self::price_feed(env).unwrap_or_panic(env, WorkerError::PriceFeedNotSet);
        let worker_fee_lib = Self::worker_fee_lib(env).unwrap_or_panic(env, WorkerError::WorkerFeeLibNotSet);
        let fee_params = FeeParams {
            sender: sender.clone(),
            dst_eid,
            calldata_size,
            options: options.clone(),
            price_feed,
            default_multiplier_bps: Self::default_multiplier_bps(env),
            lz_receive_base_gas: dst_config.lz_receive_base_gas,
            lz_compose_base_gas: dst_config.lz_compose_base_gas,
            floor_margin_usd: dst_config.floor_margin_usd,
            native_cap: dst_config.native_cap,
            multiplier_bps: dst_config.multiplier_bps,
        };

        ExecutorFeeLibClient::new(env, &worker_fee_lib).get_fee(&env.current_contract_address(), &fee_params)
    }
}

// ============================================================================
// Worker Implementation
// ============================================================================

#[contract_impl(contracttrait)]
impl Worker for LzExecutor {}

// ============================================================================
// Include SubModules
// ============================================================================

#[path = "auth.rs"]
pub mod auth;
