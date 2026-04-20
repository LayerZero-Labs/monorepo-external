//! LayerZero Decentralized Verifier Network (DVN) contract.
//!
//! The DVN is responsible for verifying cross-chain messages by providing
//! cryptographic attestations. It uses a multisig scheme with secp256k1
//! signatures for authorization and implements Soroban's custom account
//! interface for transaction signing.

use crate::{
    errors::DvnError,
    events::{SetDstConfig, SetUpgrader},
    storage::DvnStorage,
    Call, DstConfig, DstConfigParam, IDVN,
};
use common_macros::{contract_impl, lz_contract, only_auth};
use endpoint_v2::FeeRecipient;
use fee_lib_interfaces::{DvnFeeLibClient, DvnFeeParams};
use message_lib_common::interfaces::ILayerZeroDVN;
use soroban_sdk::{xdr::ToXdr, Address, Bytes, BytesN, Env, Val, Vec};
use utils::{buffer_writer::BufferWriter, multisig, option_ext::OptionExt};
use worker::{
    assert_acl, assert_not_paused, assert_supported_message_lib, init_worker, require_admin_auth, set_admin_by_admin,
    Worker, WorkerError,
};

/// LayerZero DVN contract.
///
/// Implements multisig-based verification with custom account authorization.
/// The contract owns itself, allowing the multisig quorum to authorize operations.
#[lz_contract(multisig, upgradeable(no_migration))]
pub struct LzDVN;

// ============================================================================
// Core Implementation
// ============================================================================

#[contract_impl]
impl LzDVN {
    /// Initializes the DVN contract.
    ///
    /// # Arguments
    /// * `vid` - Verifier ID, unique identifier for this DVN
    /// * `signers` - Initial multisig signers (20-byte Ethereum addresses)
    /// * `threshold` - Minimum signatures required for multisig operations
    /// * `admins` - Initial admin addresses for operational functions
    /// * `supported_msglibs` - Message libraries this DVN supports (e.g., ULN302)
    /// * `price_feed` - Price feed contract for fee calculations
    /// * `default_multiplier_bps` - Default fee multiplier (10000 = 1x)
    /// * `worker_fee_lib` - Fee library contract for computing DVN fees
    /// * `deposit_address` - Address to receive fee payments
    pub fn __constructor(
        env: &Env,
        vid: u32,
        signers: &Vec<BytesN<20>>,
        threshold: u32,
        admins: &Vec<Address>,
        supported_msglibs: &Vec<Address>,
        price_feed: &Address,
        default_multiplier_bps: u32,
        worker_fee_lib: &Address,
        deposit_address: &Address,
    ) {
        multisig::init_multisig(env, signers, threshold);
        init_worker::<Self>(
            env,
            admins,
            supported_msglibs,
            price_feed,
            default_multiplier_bps,
            worker_fee_lib,
            deposit_address,
        );

        DvnStorage::set_vid(env, &vid);
    }

    /// Sets admin status for an address. Can be called by an existing admin.
    ///
    /// This allows existing admins to add or remove other admins without going through
    /// the owner/multisig path.
    ///
    /// # Arguments
    /// * `caller` - The admin calling this function (must provide authorization)
    /// * `admin` - The address to set admin status for
    /// * `active` - `true` to add admin, `false` to remove
    pub fn set_admin_by_admin(env: &Env, caller: &Address, admin: &Address, active: bool) {
        set_admin_by_admin::<Self>(env, caller, admin, active);
    }
}

// ============================================================================
// IDVN Implementation
// ============================================================================

#[contract_impl]
impl IDVN for LzDVN {
    /// Dispatches external contract calls.
    #[only_auth]
    fn execute_transaction(env: &Env, calls: &Vec<Call>) {
        for call in calls.iter() {
            env.invoke_contract::<Val>(&call.to, &call.func, call.args);
        }
    }

    /// Sets the upgrader contract address. Requires self authorization.
    #[only_auth]
    fn set_upgrader(env: &Env, upgrader: &Option<Address>) {
        DvnStorage::set_or_remove_upgrader(env, upgrader);
        SetUpgrader { upgrader: upgrader.clone() }.publish(env);
    }

    /// Returns the current upgrader contract address, if set.
    fn upgrader(env: &Env) -> Option<Address> {
        DvnStorage::upgrader(env)
    }

    /// Sets destination chain configurations. Requires admin authorization.
    fn set_dst_config(env: &Env, admin: &Address, params: &Vec<DstConfigParam>) {
        require_admin_auth::<Self>(env, admin);
        params.iter().for_each(|param| DvnStorage::set_dst_config(env, param.dst_eid, &param.config));

        SetDstConfig { params: params.clone() }.publish(env);
    }

    /// Returns the destination configuration for a specific endpoint ID.
    fn dst_config(env: &Env, dst_eid: u32) -> Option<DstConfig> {
        DvnStorage::dst_config(env, dst_eid)
    }

    /// Returns the Verifier ID for this DVN.
    fn vid(env: &Env) -> u32 {
        // VID is always set during initialization, so unwrap is safe here
        DvnStorage::vid(env).unwrap()
    }

    /// Computes the hash of call data for multisig signing.
    ///
    /// Off-chain signers use this to compute the hash they need to sign.
    fn hash_call_data(env: &Env, vid: u32, expiration: u64, calls: &Vec<Call>) -> BytesN<32> {
        let mut writer = BufferWriter::new(env);
        let data = writer.write_u32(vid).write_u64(expiration).write_bytes(&calls.to_xdr(env)).to_bytes();
        env.crypto().keccak256(&data).into()
    }
}

// ============================================================================
// ILayerZeroDVN Implementation (Send Flow)
// ============================================================================

#[contract_impl]
impl ILayerZeroDVN for LzDVN {
    /// Calculates the verification fee for a cross-chain message.
    ///
    /// Called by the send library to quote DVN fees before sending.
    fn get_fee(
        env: &Env,
        _send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        _packet_header: &Bytes,
        _payload_hash: &BytesN<32>,
        confirmations: u64,
        options: &Bytes,
    ) -> i128 {
        assert_not_paused::<Self>(env);
        assert_acl::<Self>(env, sender);

        let dst_config = Self::dst_config(env, dst_eid).unwrap_or_panic(env, DvnError::EidNotSupported);
        let price_feed = Self::price_feed(env).unwrap_or_panic(env, WorkerError::PriceFeedNotSet);
        let worker_fee_lib = Self::worker_fee_lib(env).unwrap_or_panic(env, WorkerError::WorkerFeeLibNotSet);
        let params = DvnFeeParams {
            sender: sender.clone(),
            dst_eid,
            confirmations,
            options: options.clone(),
            price_feed,
            default_multiplier_bps: Self::default_multiplier_bps(env),
            quorum: Self::threshold(env),
            gas: dst_config.gas,
            multiplier_bps: dst_config.multiplier_bps,
            floor_margin_usd: dst_config.floor_margin_usd,
        };

        DvnFeeLibClient::new(env, &worker_fee_lib).get_fee(&env.current_contract_address(), &params)
    }

    /// Assigns a verification job to this DVN and returns fee payment info.
    ///
    /// Called by the send library when a message is sent. The DVN will later
    /// verify the message on the destination chain.
    fn assign_job(
        env: &Env,
        send_lib: &Address,
        sender: &Address,
        dst_eid: u32,
        packet_header: &Bytes,
        payload_hash: &BytesN<32>,
        confirmations: u64,
        options: &Bytes,
    ) -> FeeRecipient {
        send_lib.require_auth();
        assert_supported_message_lib::<Self>(env, send_lib);

        let fee = Self::get_fee(env, send_lib, sender, dst_eid, packet_header, payload_hash, confirmations, options);
        let deposit_address = Self::deposit_address(env).unwrap_or_panic(env, WorkerError::DepositAddressNotSet);
        FeeRecipient { amount: fee, to: deposit_address }
    }
}

// ============================================================================
// Worker Implementation
// ============================================================================

/// Worker trait implementation using default methods for pause, admin, ACL, and fee configuration.
#[contract_impl(contracttrait)]
impl Worker for LzDVN {}

// ============================================================================
// Include Auth Module
// ============================================================================

#[path = "auth.rs"]
mod auth;
