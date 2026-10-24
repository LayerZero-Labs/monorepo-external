#![no_std]

//! # Upgrader Contract
//!
//! A stateless utility contract for performing atomic upgrade-and-migrate operations
//! on contracts that implement [`Upgradeable`](utils::upgradeable::Upgradeable) (Auth-based)
//! or [`UpgradeableRbac`](utils::upgradeable::UpgradeableRbac) (RBAC-based).
//!
//! ## Security model
//!
//! The Upgrader is permissionless: anyone may call it. Security is enforced by the target
//! contract’s authorization:
//! - **Auth-based**: the target’s `#[only_auth]` ensures only its authorizer can upgrade/migrate.
//! - **RBAC-based**: the target’s `#[only_role(operator, UPGRADER_ROLE)]` ensures only an
//!   address with `UPGRADER_ROLE` can upgrade/migrate; that address must be passed as `operator`
//!   and must have signed the transaction.
//!
//! ## Usage
//!
//! - For **Auth-based** targets, pass `operator: &None`. The transaction must be authorized
//!   by the target contract’s authorizer.
//! - For **RBAC-based** targets, pass `operator: &Some(upgrader_address)`. The transaction
//!   must be signed by that address, which must hold `UPGRADER_ROLE` on the target.
//!
//! ```ignore
//! let upgrader = UpgraderClient::new(&env, &upgrader_id);
//! let migration_data = my_data.to_xdr(&env);
//! // Auth-based target:
//! upgrader.upgrade_and_migrate(&target_contract, &new_wasm_hash, &migration_data, &None);
//! // RBAC-based target:
//! upgrader.upgrade_and_migrate(&target_contract, &new_wasm_hash, &migration_data, &Some(operator));
//! ```

use soroban_sdk::{contract, contractimpl, xdr::ToXdr, Address, Bytes, BytesN, Env};
use utils::{
    auth::AuthClient,
    errors::AuthError,
    option_ext::OptionExt,
    upgradeable::{UpgradeableClient, UpgradeableRbacClient},
};

/// Upgrader contract for managing upgrades of other contracts.
///
/// Stateless utility: anyone may call it. Authorization is enforced by the target
/// contract (Auth or RBAC).
#[contract]
pub struct Upgrader;

#[contractimpl]
impl Upgrader {
    /// Upgrades a target contract without custom migration data.
    ///
    /// Convenience wrapper around [`upgrade_and_migrate`](Self::upgrade_and_migrate) that
    /// passes empty migration data (XDR encoding of `()`). Use only when the target’s
    /// `MigrationData` is `()` or it supports empty migration.
    ///
    /// # Arguments
    /// * `contract_address` - Address of the contract to upgrade.
    /// * `wasm_hash` - Hash of the new WASM bytecode.
    /// * `operator` - `None` for Auth-based targets; `Some(addr)` for RBAC-based targets
    pub fn upgrade(env: &Env, contract_address: &Address, wasm_hash: &BytesN<32>, operator: &Option<Address>) {
        Self::upgrade_and_migrate(env, contract_address, wasm_hash, &().to_xdr(env), operator);
    }

    /// Upgrades a target contract and runs its migration in a single transaction.
    ///
    /// Chooses Auth-based or RBAC-based flow from `operator`:
    /// - **`Some(operator)`**: RBAC flow. `operator` must sign the transaction and must have
    ///   `UPGRADER_ROLE` on the target. The target must implement [`UpgradeableRbac`](utils::upgradeable::UpgradeableRbac).
    /// - **`None`**: Auth flow. The target’s authorizer must sign the transaction. The target
    ///   must implement [`Upgradeable`](utils::upgradeable::Upgradeable).
    ///
    /// # Arguments
    /// * `contract_address` - Address of the contract to upgrade.
    /// * `wasm_hash` - Hash of the new WASM bytecode.
    /// * `migration_data` - XDR-encoded migration payload. Use `value.to_xdr(&env)` for the
    ///   target contract’s `MigrationData` type; use `().to_xdr(&env)` for no custom data.
    /// * `operator` - `None` for Auth-based target; `Some(operator)` for RBAC-based target.
    ///
    /// # Example
    /// ```ignore
    /// let migration_data = my_data.to_xdr(&env);
    /// upgrader.upgrade_and_migrate(&contract_addr, &wasm_hash, &migration_data, &None);
    /// ```
    pub fn upgrade_and_migrate(
        env: &Env,
        contract_address: &Address,
        wasm_hash: &BytesN<32>,
        migration_data: &Bytes,
        operator: &Option<Address>,
    ) {
        if let Some(operator) = operator {
            operator.require_auth();
            let client = UpgradeableRbacClient::new(env, contract_address);
            client.upgrade(wasm_hash, operator);
            client.migrate(migration_data, operator);
        } else {
            AuthClient::new(env, contract_address)
                .authorizer()
                .unwrap_or_panic(env, AuthError::AuthorizerNotFound)
                .require_auth();
            let client = UpgradeableClient::new(env, contract_address);
            client.upgrade(wasm_hash);
            client.migrate(migration_data);
        }
    }
}

#[cfg(test)]
mod tests;
