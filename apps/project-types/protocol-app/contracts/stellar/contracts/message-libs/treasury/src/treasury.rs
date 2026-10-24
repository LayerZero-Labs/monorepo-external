use crate::{
    errors::TreasuryError,
    events::{FeeEnabledSet, NativeFeeBpSet, TokenWithdrawn, ZroFeeLibSet},
    interfaces::ZroFeeLibClient,
    storage::TreasuryStorage,
};
use common_macros::{contract_impl, lz_contract, only_auth};
use message_lib_common::interfaces::ILayerZeroTreasury;
use soroban_sdk::{assert_with_error, token::TokenClient, Address, Env};
use utils::option_ext::OptionExt;

/// Denominator for basis point calculations (10000 = 100%).
const BPS_DENOMINATOR: u32 = 10000;

#[lz_contract]
pub struct Treasury;

#[contract_impl]
impl Treasury {
    pub fn __constructor(env: &Env, owner: &Address) {
        Self::init_owner(env, owner);
    }

    // ============================================================================================
    // Owner Management Functions
    // ============================================================================================

    /// Sets the native fee percentage in basis points.
    ///
    /// # Arguments
    /// * `native_fee_bp` - Fee percentage in basis points (0-10000, where 10000 = 100%)
    #[only_auth]
    pub fn set_native_fee_bp(env: &Env, native_fee_bp: u32) {
        assert_with_error!(env, native_fee_bp <= BPS_DENOMINATOR, TreasuryError::InvalidNativeFeeBp);
        TreasuryStorage::set_native_fee_bp(env, &native_fee_bp);
        NativeFeeBpSet { native_fee_bp }.publish(env);
    }

    /// Enables or disables fee collection globally.
    ///
    /// # Arguments
    /// * `fee_enabled` - Whether fee collection is enabled
    #[only_auth]
    pub fn set_fee_enabled(env: &Env, fee_enabled: bool) {
        TreasuryStorage::set_fee_enabled(env, &fee_enabled);
        FeeEnabledSet { fee_enabled }.publish(env);
    }

    /// Sets or removes the ZRO fee library for custom ZRO token fee calculations.
    ///
    /// # Arguments
    /// * `zro_fee_lib` - The ZRO fee library contract address, or `None` to remove
    #[only_auth]
    pub fn set_zro_fee_lib(env: &Env, zro_fee_lib: &Option<Address>) {
        TreasuryStorage::set_or_remove_zro_fee_lib(env, zro_fee_lib);
        ZroFeeLibSet { zro_fee_lib: zro_fee_lib.clone() }.publish(env);
    }

    /// Withdraws any token (including native XLM) from the contract to a specified address.
    ///
    /// Only the contract owner can execute this method.
    ///
    /// # Arguments
    /// * `token` - The token contract address (can be native XLM or any other token)
    /// * `to` - The recipient address
    /// * `amount` - The amount to withdraw (must be positive)
    #[only_auth]
    pub fn withdraw_token(env: &Env, token: &Address, to: &Address, amount: i128) {
        TokenClient::new(env, token).transfer(&env.current_contract_address(), to, &amount);
        TokenWithdrawn { token: token.clone(), to: to.clone(), amount }.publish(env);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    /// Returns the native fee percentage in basis points.
    pub fn native_fee_bp(env: &Env) -> u32 {
        TreasuryStorage::native_fee_bp(env)
    }

    /// Returns whether fee collection is enabled.
    pub fn fee_enabled(env: &Env) -> bool {
        TreasuryStorage::fee_enabled(env)
    }

    /// Returns the ZRO fee library address if set.
    pub fn zro_fee_lib(env: &Env) -> Option<Address> {
        TreasuryStorage::zro_fee_lib(env)
    }

    // ============================================================================================
    // Internal Functions
    // ============================================================================================

    /// Calculates the treasury fee based on the total native fee and configured basis points.
    fn calculate_native_fee(env: &Env, total_native_fee: i128) -> i128 {
        total_native_fee * Self::native_fee_bp(env) as i128 / BPS_DENOMINATOR as i128
    }

    /// Returns the ZRO fee library client, panics if not set.
    fn expect_zro_fee_lib_client(env: &Env) -> ZroFeeLibClient<'static> {
        let fee_lib = Self::zro_fee_lib(env).unwrap_or_panic(env, TreasuryError::ZroFeeLibNotSet);
        ZroFeeLibClient::new(env, &fee_lib)
    }
}

// ============================================================================
// ILayerZeroTreasury Implementation
// ============================================================================

#[contract_impl]
impl ILayerZeroTreasury for Treasury {
    /// Get the treasury fee for a cross-chain message.
    ///
    /// Returns 0 if fee collection is disabled. For ZRO payments, delegates to the ZRO fee library.
    fn get_fee(env: &Env, sender: &Address, dst_eid: u32, total_native_fee: i128, pay_in_zro: bool) -> i128 {
        assert_with_error!(env, total_native_fee >= 0, TreasuryError::InvalidTotalNativeFee);

        // If fee collection is disabled, return 0
        if !Self::fee_enabled(env) {
            return 0;
        }

        // If paying in native, calculate and return the native treasury fee
        let native_treasury_fee = Self::calculate_native_fee(env, total_native_fee);
        if !pay_in_zro {
            return native_treasury_fee;
        }

        // If paying in ZRO, quote the ZRO fee from the ZRO fee library
        let zro_fee =
            Self::expect_zro_fee_lib_client(env).get_fee(sender, &dst_eid, &total_native_fee, &native_treasury_fee);
        assert_with_error!(env, zro_fee >= 0, TreasuryError::InvalidZroFee);
        zro_fee
    }
}
