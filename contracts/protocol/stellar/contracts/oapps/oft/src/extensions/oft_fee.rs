use common_macros::{contract_error, contract_trait, only_role, storage};
use soroban_sdk::{assert_with_error, contractevent, token::TokenClient, Address, Env};
use utils::{
    option_ext::OptionExt,
    rbac::{RoleBasedAccessControl, AUTHORIZER},
};

/// Role for fee configuration (set_default_fee_bps, set_fee_bps).
pub const FEE_CONFIG_MANAGER_ROLE: &str = "FEE_CONFIG_MANAGER_ROLE";

/// Base fee in basis points (10,000 BPS = 100%)
/// Used as denominator in fee calculations
const BASE_FEE_BPS: u32 = 10_000;

// =========================================================================
// Storage
// =========================================================================

#[storage]
pub enum OFTFeeStorage {
    /// Default fee rate in basis points (1-10,000, where 10,000 = 100%)
    /// Applied to destinations without specific fee configuration
    /// Not set by default (effective rate is 0 when unset)
    #[instance(u32)]
    DefaultFeeBps,

    /// Destination-specific fee rates mapped by endpoint ID (eid)
    #[persistent(u32)]
    FeeBps { eid: u32 },

    /// Address where collected fees will be deposited
    #[instance(Address)]
    FeeDepositAddress,
}

// =========================================================================
// Errors
// =========================================================================

#[contract_error]
pub enum OFTFeeError {
    InvalidFeeBps = 3100,
    InvalidFeeDepositAddress,
    SameValue,
}

// =========================================================================
// Events
// =========================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultFeeBpsSet {
    /// The default fee rate in basis points, or None if the default fee is removed
    pub fee_bps: Option<u32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeBpsSet {
    pub dst_eid: u32,
    /// The fee rate in basis points, or None if the fee is removed
    pub fee_bps: Option<u32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeDepositAddressSet {
    /// The address to deposit fees to, or None to remove the fee deposit address
    pub fee_deposit_address: Option<Address>,
}

// =========================================================================
// Trait With Default Implementations
// =========================================================================

#[contract_trait]
pub trait OFTFee: OFTFeeInternal + RoleBasedAccessControl {
    // =========================================================================
    // Management Functions
    // =========================================================================

    /// Sets or removes the default fee rate in basis points.
    ///
    /// - `Some(n)`: sets the default fee to `n` basis points (must be >0 and <=10,000).
    /// - `Some(0)`: rejected — use `None` to remove the default fee instead.
    /// - `None`: removes the default fee (effective rate becomes 0).
    /// * `operator` - The address that must have FEE_CONFIG_MANAGER_ROLE
    #[only_role(operator, FEE_CONFIG_MANAGER_ROLE)]
    fn set_default_fee_bps(env: &soroban_sdk::Env, default_fee_bps: &Option<u32>, operator: &soroban_sdk::Address) {
        Self::__set_default_fee_bps(env, default_fee_bps);
    }

    /// Sets or removes the fee rate for a specific destination endpoint.
    ///
    /// - `Some(0)`: explicitly sets zero fee for this destination, overriding the default fee.
    /// - `None`: removes the per-destination override; falls back to the default fee.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    /// * `fee_bps` - The fee rate (0-10,000), or None to remove the fee configuration
    /// * `operator` - The address that must have FEE_CONFIG_MANAGER_ROLE
    #[only_role(operator, FEE_CONFIG_MANAGER_ROLE)]
    fn set_fee_bps(env: &soroban_sdk::Env, dst_eid: u32, fee_bps: &Option<u32>, operator: &soroban_sdk::Address) {
        Self::__set_fee_bps(env, dst_eid, fee_bps);
    }

    /// Sets or removes the address where collected fees will be deposited.
    ///
    /// # Arguments
    /// * `fee_deposit_address` - The address to deposit fees to, or None to remove the fee deposit address
    /// * `operator` - The authorizer address
    #[only_role(operator, AUTHORIZER)]
    fn set_fee_deposit_address(
        env: &soroban_sdk::Env,
        fee_deposit_address: &Option<soroban_sdk::Address>,
        operator: &soroban_sdk::Address,
    ) {
        Self::__set_fee_deposit_address(env, fee_deposit_address);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// Returns the default fee rate in basis points, if set.
    fn default_fee_bps(env: &soroban_sdk::Env) -> Option<u32> {
        Self::__default_fee_bps(env)
    }

    /// Returns the fee rate for a specific destination, if set.
    fn fee_bps(env: &soroban_sdk::Env, dst_eid: u32) -> Option<u32> {
        Self::__fee_bps(env, dst_eid)
    }

    /// Returns the effective fee rate for a destination (destination-specific or default).
    fn effective_fee_bps(env: &soroban_sdk::Env, dst_eid: u32) -> u32 {
        Self::__effective_fee_bps(env, dst_eid)
    }

    /// Returns true if the OFT has a fee rate greater than 0 for the specified destination
    fn has_oft_fee(env: &soroban_sdk::Env, dst_eid: u32) -> bool {
        Self::__effective_fee_bps(env, dst_eid) > 0
    }

    /// Returns the fee deposit address.
    fn fee_deposit_address(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
        Self::__fee_deposit_address(env)
    }
}

/// Internal trait for OFT fee operations used by OFT hooks.
/// Contains only truly internal methods that are called from OFTFee implementations.
pub trait OFTFeeInternal {
    // =========================================================================
    // OFT Hooks
    // =========================================================================

    /// Calculates the fee amount for a given transfer (read-only).
    /// Used internally by `__debit_view` to calculate the fee.
    ///
    /// # Arguments
    /// * `dst_eid` - Destination endpoint ID to determine which fee rate to apply
    /// * `amount_ld` - The original amount in local decimals
    ///
    /// # Returns
    /// The fee amount to be deducted
    fn __fee_view(env: &Env, dst_eid: u32, amount_ld: i128) -> i128 {
        let fee_bps = Self::__effective_fee_bps(env, dst_eid);
        if fee_bps == 0 {
            return 0;
        }

        // Check that fee deposit address is set (required for fee collection)
        assert_with_error!(env, OFTFeeStorage::has_fee_deposit_address(env), OFTFeeError::InvalidFeeDepositAddress);

        (amount_ld * fee_bps as i128) / BASE_FEE_BPS as i128
    }

    /// Charges the fee by transferring the fee amount from the sender to the fee deposit address.
    /// Used internally by `__debit` to collect the fee.
    ///
    /// # Arguments
    /// * `token` - The token address to transfer
    /// * `from` - The address to transfer fee from
    /// * `fee_amount` - The fee amount to transfer
    fn __charge_fee(env: &Env, token: &Address, from: &Address, fee_amount: i128) {
        if fee_amount != 0 {
            let fee_deposit =
                Self::__fee_deposit_address(env).unwrap_or_panic(env, OFTFeeError::InvalidFeeDepositAddress);
            TokenClient::new(env, token).transfer(from, &fee_deposit, &fee_amount);
        }
    }

    // =========================================================================
    // Management Functions
    // =========================================================================

    /// Sets or removes the default fee rate in basis points.
    ///
    /// # Arguments
    /// * `default_fee_bps` - The default fee rate (>0 and <=10,000, where 10,000 = 100%) or None to remove the default fee rate
    fn __set_default_fee_bps(env: &Env, default_fee_bps: &Option<u32>) {
        let current = Self::__default_fee_bps(env);
        assert_with_error!(env, current != *default_fee_bps, OFTFeeError::SameValue);
        assert_with_error!(
            env,
            default_fee_bps.is_none_or(|bps| bps > 0 && bps <= BASE_FEE_BPS),
            OFTFeeError::InvalidFeeBps
        );

        OFTFeeStorage::set_or_remove_default_fee_bps(env, default_fee_bps);
        DefaultFeeBpsSet { fee_bps: *default_fee_bps }.publish(env);
    }

    /// Sets or removes the fee rate for a specific destination endpoint.
    ///
    /// - `Some(0)`: explicitly sets zero fee for this destination, overriding the default fee.
    /// - `None`: removes the per-destination override; falls back to the default fee.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    /// * `fee_bps` - The fee rate (0-10,000), or None to remove the fee configuration
    fn __set_fee_bps(env: &Env, dst_eid: u32, fee_bps: &Option<u32>) {
        let current_fee_bps = Self::__fee_bps(env, dst_eid);
        assert_with_error!(env, current_fee_bps != *fee_bps, OFTFeeError::SameValue);
        assert_with_error!(env, fee_bps.is_none_or(|bps| bps <= BASE_FEE_BPS), OFTFeeError::InvalidFeeBps);

        OFTFeeStorage::set_or_remove_fee_bps(env, dst_eid, fee_bps);

        FeeBpsSet { dst_eid, fee_bps: *fee_bps }.publish(env);
    }

    /// Sets or removes the address where collected fees will be deposited.
    ///
    /// # Arguments
    /// * `fee_deposit_address` - The address to deposit fees to, or None to remove the fee deposit address
    fn __set_fee_deposit_address(env: &Env, fee_deposit_address: &Option<Address>) {
        let current = Self::__fee_deposit_address(env);
        assert_with_error!(env, current != *fee_deposit_address, OFTFeeError::SameValue);
        OFTFeeStorage::set_or_remove_fee_deposit_address(env, fee_deposit_address);
        FeeDepositAddressSet { fee_deposit_address: fee_deposit_address.clone() }.publish(env);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// Returns the effective fee rate for a destination (destination-specific or default, 0 if neither).
    fn __effective_fee_bps(env: &Env, dst_eid: u32) -> u32 {
        Self::__fee_bps(env, dst_eid).or_else(|| Self::__default_fee_bps(env)).unwrap_or(0)
    }

    /// Returns the default fee rate in basis points, if set.
    fn __default_fee_bps(env: &Env) -> Option<u32> {
        OFTFeeStorage::default_fee_bps(env)
    }

    /// Returns the fee rate for a specific destination, if set.
    fn __fee_bps(env: &Env, dst_eid: u32) -> Option<u32> {
        OFTFeeStorage::fee_bps(env, dst_eid)
    }

    /// Returns the fee deposit address.
    fn __fee_deposit_address(env: &Env) -> Option<Address> {
        OFTFeeStorage::fee_deposit_address(env)
    }

    /// Back-calculates the pre-fee amount given a post-fee amount.
    /// Returns the smallest `x` such that `x - fee(x) >= amount_after_fee`.
    fn __amount_before_fee(env: &Env, dst_eid: u32, amount_after_fee: i128) -> i128 {
        let fee_bps = Self::__effective_fee_bps(env, dst_eid);
        if fee_bps == 0 {
            return amount_after_fee;
        }
        if fee_bps == BASE_FEE_BPS {
            return 0;
        }
        (amount_after_fee * BASE_FEE_BPS as i128) / (BASE_FEE_BPS - fee_bps) as i128
    }
}
