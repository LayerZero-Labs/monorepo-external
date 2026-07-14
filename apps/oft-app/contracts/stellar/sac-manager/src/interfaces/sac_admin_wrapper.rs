//! SAC Admin Wrapper trait definition.
//!
//! Defines the admin operations that can be performed on a Stellar Asset Contract (SAC).

use common_macros::contract_trait;
use soroban_sdk::{Address, Env};

#[contract_trait]
pub trait SACAdminWrapper {
    /// Sets the administrator to the specified address `new_admin`.
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment.
    /// * `new_admin` - The address which will be the administrator of the token contract.
    /// * `operator` - The address authorizing the invocation.
    fn set_admin(env: &Env, new_admin: &Address, operator: &Address);

    /// Sets whether the account is authorized to use its balance.
    /// If `authorize` is true, `id` can use its balance; otherwise it is blacklisted.
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment.
    /// * `id` - The address being (de-)authorized.
    /// * `authorize` - Whether `id` can use its balance.
    /// * `operator` - The address authorizing the invocation.
    fn set_authorized(env: &Env, id: &Address, authorize: bool, operator: &Address);

    /// Clawback `amount` from `from` account. The amount is burned in the clawback process.
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment.
    /// * `from` - The address holding the balance to claw back from.
    /// * `amount` - The amount of tokens to claw back.
    /// * `operator` - The address authorizing the invocation.
    fn clawback(env: &Env, from: &Address, amount: i128, operator: &Address);

    /// Mints `amount` to `to`.
    ///
    /// # Arguments
    ///
    /// * `env` - The Soroban environment.
    /// * `to` - The address which will receive the minted tokens.
    /// * `amount` - The amount of tokens to be minted.
    /// * `operator` - The address authorizing the invocation.
    fn mint(env: &Env, to: &Address, amount: i128, operator: &Address);
}
