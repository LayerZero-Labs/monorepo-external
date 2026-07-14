use crate::{self as utils, auth::Auth, errors::UpgradeableError, option_ext::OptionExt, rbac::RoleBasedAccessControl};
use common_macros::{contract_trait, only_auth, only_role, storage};
use soroban_sdk::{assert_with_error, xdr::FromXdr, Bytes, BytesN, Env};

/// Role for upgrading the contract and running migrations.
pub const UPGRADER_ROLE: &str = "UPGRADER_ROLE";

/// Trait for contracts with upgrade and migration support (Auth-based).
///
/// Implements a two-phase upgrade pattern:
/// 1. `upgrade` - Updates WASM bytecode and sets migration flag
/// 2. `migrate` - Runs state migration and clears the flag
///
/// Requires implementing [`UpgradeableInternal`] and [`Auth`].
#[contract_trait]
pub trait Upgradeable: UpgradeableInternal + Auth {
    /// Upgrades the contract to new WASM bytecode.
    #[only_auth]
    fn upgrade(env: &soroban_sdk::Env, new_wasm_hash: &soroban_sdk::BytesN<32>) {
        upgrade(env, new_wasm_hash);
    }

    /// Runs migration logic after an upgrade.
    #[only_auth]
    fn migrate(env: &soroban_sdk::Env, migration_data: &soroban_sdk::Bytes) {
        migrate::<Self>(env, migration_data);
    }
}

/// Trait for contracts with upgrade and migration support (RBAC-based).
///
/// Same two-phase upgrade pattern as [`Upgradeable`], but access control uses
/// `UPGRADER_ROLE` instead of Auth. Requires implementing [`UpgradeableInternal`]
/// and [`RoleBasedAccessControl`].
#[contract_trait]
pub trait UpgradeableRbac: UpgradeableInternal + RoleBasedAccessControl {
    /// Upgrades the contract to new WASM bytecode.
    #[only_role(operator, UPGRADER_ROLE)]
    fn upgrade(env: &soroban_sdk::Env, new_wasm_hash: &soroban_sdk::BytesN<32>, operator: &soroban_sdk::Address) {
        upgrade(env, new_wasm_hash);
    }

    /// Runs migration logic after an upgrade.
    #[only_role(operator, UPGRADER_ROLE)]
    fn migrate(env: &soroban_sdk::Env, migration_data: &soroban_sdk::Bytes, operator: &soroban_sdk::Address) {
        migrate::<Self>(env, migration_data);
    }
}

/// Trait for defining contract-specific migration logic.
/// Must be implemented by contracts using [`Upgradeable`] or [`UpgradeableRbac`].
pub trait UpgradeableInternal {
    /// The XDR-decodable type for migration data. Use `()` if not needed.
    type MigrationData: FromXdr;

    /// Migration logic called by `migrate`. Implement state transformations here.
    fn __migrate(env: &Env, migration_data: &Self::MigrationData);
}

// ============================================
// Helper Functions
// ============================================

/// Core upgrade logic: set migrating flag and update WASM.
///
/// # Arguments
/// - `new_wasm_hash` - The hash of the new WASM bytecode
fn upgrade(env: &Env, new_wasm_hash: &BytesN<32>) {
    UpgradeableStorage::set_migrating(env, &true);
    env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
}

/// Core migration logic: parse migration data, call `__migrate`, clear flag.
///
/// # Arguments
/// - `migration_data` - The migration data
///
/// # Panics
/// - `MigrationNotAllowed` if no migration is in progress
/// - `InvalidMigrationData` if the migration data cannot be parsed into the contract's `MigrationData` type
fn migrate<T: UpgradeableInternal>(env: &Env, migration_data: &Bytes) {
    assert_with_error!(env, UpgradeableStorage::migrating(env), UpgradeableError::MigrationNotAllowed);

    let parsed_data = T::MigrationData::from_xdr(env, migration_data)
        .ok()
        .unwrap_or_panic(env, UpgradeableError::InvalidMigrationData);
    T::__migrate(env, &parsed_data);

    UpgradeableStorage::set_migrating(env, &false);
}

// ============================================
// Storage
// ============================================

/// Storage for upgrade state.
#[storage]
pub enum UpgradeableStorage {
    /// Whether a migration is pending.
    #[instance(bool)]
    #[default(false)]
    Migrating,
}
