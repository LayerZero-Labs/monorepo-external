//! ABA-safe entry point for cross-chain message execution on Stellar.
//! Prevents reentry into the Executor during OApp Atomic Batch Actions.

use common_macros::contract_impl;
use endpoint_v2::{
    LayerZeroComposerClient, LayerZeroEndpointV2Client, LayerZeroReceiverClient, MessagingComposerClient, Origin,
};
use executor::{ExecutorClient, NativeDropParams};
use soroban_sdk::{contract, contracttype, token::TokenClient, Address, Bytes, BytesN, Env, Vec};

/// Parameters for `lz_receive` execution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionParams {
    pub receiver: Address,
    pub origin: Origin,
    pub guid: BytesN<32>,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub value: i128,
    pub gas_limit: i128,
}

/// Parameters for `lz_compose` execution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComposeParams {
    pub from: Address,
    pub to: Address,
    pub guid: BytesN<32>,
    pub index: u32,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub value: i128,
    pub gas_limit: i128,
}

#[contract]
pub struct ExecutorHelper;

#[contract_impl]
impl ExecutorHelper {
    /// Executes `lz_receive` on the target OApp
    pub fn execute(env: &Env, executor: &Address, params: &ExecutionParams, value_payer: &Address) {
        executor.require_auth();
        if params.value != 0 {
            value_payer.require_auth();
            transfer_value(env, value_payer, executor, params.value);
        }
        LayerZeroReceiverClient::new(env, &params.receiver).lz_receive(
            executor,
            &params.origin,
            &params.guid,
            &params.message,
            &params.extra_data,
            &params.value,
        );
    }

    /// Records a failed `lz_receive` execution for off-chain processing.
    pub fn lz_receive_alert(env: &Env, executor: &Address, params: &ExecutionParams, reason: &Bytes) {
        let endpoint = ExecutorClient::new(env, executor).endpoint();
        LayerZeroEndpointV2Client::new(env, &endpoint).lz_receive_alert(
            executor,
            &params.origin,
            &params.receiver,
            &params.guid,
            &params.gas_limit,
            &params.value,
            &params.message,
            &params.extra_data,
            reason,
        );
    }

    /// Executes `lz_compose` on the target composer
    pub fn compose(env: &Env, executor: &Address, params: &ComposeParams, value_payer: &Address) {
        executor.require_auth();
        if params.value != 0 {
            value_payer.require_auth();
            transfer_value(env, value_payer, executor, params.value);
        }
        LayerZeroComposerClient::new(env, &params.to).lz_compose(
            executor,
            &params.from,
            &params.guid,
            &params.index,
            &params.message,
            &params.extra_data,
            &params.value,
        );
    }

    /// Records a failed `lz_compose` execution for off-chain processing.
    pub fn lz_compose_alert(env: &Env, executor: &Address, params: &ComposeParams, reason: &Bytes) {
        let endpoint = ExecutorClient::new(env, executor).endpoint();
        MessagingComposerClient::new(env, &endpoint).lz_compose_alert(
            executor,
            &params.from,
            &params.to,
            &params.guid,
            &params.index,
            &params.gas_limit,
            &params.value,
            &params.message,
            &params.extra_data,
            reason,
        );
    }

    /// Delegates `native_drop` to the executor contract.
    pub fn native_drop(
        env: &Env,
        executor: &Address,
        admin: &Address,
        origin: &Origin,
        dst_eid: u32,
        oapp: &Address,
        params: &Vec<NativeDropParams>,
    ) {
        ExecutorClient::new(env, executor).native_drop(admin, origin, &dst_eid, oapp, params);
    }

}

#[inline]
fn transfer_value(env: &Env, payer: &Address, executor: &Address, value: i128) {
    let endpoint = ExecutorClient::new(env, executor).endpoint();
    let native_token = LayerZeroEndpointV2Client::new(env, &endpoint).native_token();
    TokenClient::new(env, &native_token).transfer(payer, executor, &value);
}
