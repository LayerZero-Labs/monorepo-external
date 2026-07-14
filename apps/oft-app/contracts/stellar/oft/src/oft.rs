use crate::{
    self as oft,
    extensions::{
        oft_fee::{OFTFee, OFTFeeInternal},
        pausable::{OFTPausable, OFTPausableInternal},
        rate_limiter::{Direction, RateLimiter, RateLimiterInternal},
    },
    oft_types::{lock_unlock, mint_burn, OftType},
};
use common_macros::{contract_impl, lz_contract, storage};
use oapp_macros::oapp;
use oft_core::{
    impl_oft_lz_receive, utils as oft_utils, OFTCore, OFTError, OFTFeeDetail, OFTInternal, OFTLimit, OFTReceipt,
    SendParam,
};
use soroban_sdk::{assert_with_error, Address, Bytes, Env, Vec};

// =========================================================================
// Storage
// =========================================================================

#[storage]
enum OFTStorage {
    #[instance(OftType)]
    OftType,
}

// =========================================================================
// OFT Contract
// =========================================================================

#[lz_contract]
#[oapp]
pub struct OFT;

// LzReceiveInternal implementation using default OFT receive logic
impl_oft_lz_receive!(OFT);

#[contract_impl]
impl OFT {
    pub fn __constructor(
        env: &Env,
        token: &Address,
        shared_decimals: u32,
        oft_type: OftType,
        endpoint: &Address,
        delegate: &Address,
    ) {
        Self::__initialize_oft(env, token, shared_decimals, delegate, endpoint, delegate);
        OFTStorage::set_oft_type(env, &oft_type);
    }

    /// Returns the OFT type with its target address and configuration.
    pub fn oft_type(env: &Env) -> OftType {
        OFTStorage::oft_type(env).unwrap()
    }
}

/// OFTCore trait implementation for standard OFT with extensions
#[contract_impl(contracttrait)]
impl OFTCore for OFT {
    fn quote_oft(env: &Env, from: &Address, send_param: &SendParam) -> (OFTLimit, Vec<OFTFeeDetail>, OFTReceipt) {
        let (mut limit, mut fee_details, receipt) = Self::__quote_oft(env, from, send_param);

        // fee details (only include if there's an actual fee)
        if receipt.amount_sent_ld > receipt.amount_received_ld {
            let fee_amount_ld = receipt.amount_sent_ld - receipt.amount_received_ld;
            fee_details.push_back(OFTFeeDetail { fee_amount_ld, description: Bytes::from_slice(env, b"OFT Fee") });
        };

        // Rate limit capacity, capped to u64::MAX (the safe ceiling from __quote_oft default)
        let mut max_amount_ld = Self::rate_limit_capacity(env, &Direction::Outbound, send_param.dst_eid);
        if max_amount_ld != i128::MAX {
            // Back-calculate pre-fee amount so max_amount_ld represents the largest input to send()
            max_amount_ld = Self::__amount_before_fee(env, send_param.dst_eid, max_amount_ld);
        } else {
            // No rate limit configured — use the bounded default
            max_amount_ld = u64::MAX as i128;
        }
        limit.max_amount_ld = max_amount_ld;

        (limit, fee_details, receipt)
    }
}

/// OFT behavior for standard OFT with extension hooks
impl OFTInternal for OFT {
    /// Overrides default to add pausable check and fee calculation.
    ///
    /// Dust handling (consistent with EVM):
    /// - no fee: dust stays with sender (amount_sent_ld has dust removed)
    /// - has fee: dust is absorbed into the charged fee (amount_sent_ld is the full amount)
    fn __debit_view(env: &Env, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128) {
        Self::__assert_not_paused(env);

        let conversion_rate = Self::__decimal_conversion_rate(env);
        let has_fee = Self::has_oft_fee(env, dst_eid);

        let (amount_sent_ld, amount_received_ld) = if !has_fee {
            // No fee: dust stays with sender (default OFT behavior)
            let amount_sent_ld = oft_utils::remove_dust(amount_ld, conversion_rate);
            (amount_sent_ld, amount_sent_ld)
        } else {
            // With fee: match EVM OFTFee behavior
            // - sender pays full amount_ld (no dust removed), dust is absorbed into the charged fee
            let fee = Self::__fee_view(env, dst_eid, amount_ld);
            let amount_received_ld = oft_utils::remove_dust(amount_ld - fee, conversion_rate);
            (amount_ld, amount_received_ld)
        };

        assert_with_error!(env, amount_received_ld >= min_amount_ld, OFTError::SlippageExceeded);

        (amount_sent_ld, amount_received_ld)
    }

    fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128) {
        // Core debit logic (based on oft_type)
        let (amount_sent_ld, amount_received_ld) = match Self::oft_type(env) {
            OftType::LockUnlock => {
                lock_unlock::debit::<Self>(env, &Self::token(env), sender, amount_ld, min_amount_ld, dst_eid)
            }
            OftType::MintBurn(_mintable) => {
                mint_burn::debit::<Self>(env, &Self::token(env), sender, amount_ld, min_amount_ld, dst_eid)
            }
        };

        // Rate limit checks (using amount_received_ld - the actual cross-chain amount)
        Self::__consume_rate_limit_capacity(env, &Direction::Outbound, dst_eid, amount_received_ld);
        Self::__release_rate_limit_capacity(env, &Direction::Inbound, dst_eid, amount_received_ld);

        // Charge fee
        let fee = amount_sent_ld - amount_received_ld;
        Self::__charge_fee(env, &Self::token(env), sender, fee);

        (amount_sent_ld, amount_received_ld)
    }

    fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128 {
        // Pausable check
        Self::__assert_not_paused(env);

        // Core credit logic (based on mode)
        let amount_credited = match Self::oft_type(env) {
            OftType::LockUnlock => lock_unlock::credit::<Self>(env, &Self::token(env), to, amount_ld, src_eid),
            OftType::MintBurn(mintable) => mint_burn::credit::<Self>(env, &mintable, to, amount_ld, src_eid),
        };

        // Rate limit checks
        Self::__consume_rate_limit_capacity(env, &Direction::Inbound, src_eid, amount_ld);
        Self::__release_rate_limit_capacity(env, &Direction::Outbound, src_eid, amount_ld);

        amount_credited
    }
}

// =========================================================================
// Extension Trait Implementations
// =========================================================================

/// Pausable extension - allows pausing/unpausing the OFT
/// Default state: unpaused (all operations allowed)
#[contract_impl(contracttrait)]
impl OFTPausable for OFT {}
impl OFTPausableInternal for OFT {}

/// OFT Fee extension - allows collecting fees on transfers
/// Default state: 0 BPS (no fee collected)
#[contract_impl(contracttrait)]
impl OFTFee for OFT {}
impl OFTFeeInternal for OFT {}

/// Rate Limiter extension - allows rate limiting transfers
/// Default state: not set (rate_limit_capacity returns i128::MAX)
#[contract_impl(contracttrait)]
impl RateLimiter for OFT {}
impl RateLimiterInternal for OFT {}
