//! Common procedural macros for Stellar smart contracts.
//!
//! # Quick Links
//! - [`contract_error`] - Error enum generation macro
//! - [`contract_impl`] - Contract impl with automatic instance TTL extension
//! - [`contract_trait`] - Contract trait with automatic instance TTL extension
//! - [`lz_contract`] - Wrapper macro combining common LayerZero contract attributes
//! - [`multisig`] - MultiSig trait implementation macro
//! - [`only_auth`] - Auth-based access control attribute macro
//! - [`only_role`] - RBAC role check with auth attribute macro
//! - [`has_role`] - RBAC role check attribute macro
//! - [`ownable`] - Ownable trait implementation macro
//! - [`storage`] - Storage enum to API macro
//! - [`ttl_configurable`] - TTL configuration with freeze support
//! - [`ttl_extendable`] - Manual instance TTL extension
//! - [`upgradeable`] - Upgradeable trait implementation macro
//!

use proc_macro::TokenStream;

mod auth;
mod contract_ttl;
mod error;
mod lz_contract;
mod rbac;
mod storage;
mod ttl_configurable;
mod ttl_extendable;
mod upgradeable;
mod utils;

#[cfg(test)]
mod tests;

// ============================================================================
// Storage Macro
// ============================================================================

/// Generates strongly-typed storage API from enum variants.
///
/// Transforms a storage enum into getter/setter/remove/set_or_remove/has/extend_ttl methods.
/// TTL extension is automatic for persistent storage on get/set/has operations.
///
/// # Example
/// ```ignore
/// #[storage]
/// pub enum DataKey {
///     #[instance(u32)]
///     Counter,
///
///     #[persistent(Address)]
///     #[default(Address::default())]
///     Owner,
///
///     #[persistent(u64)]
///     Nonce { user: Address },
///
///     #[persistent(BytesN<32>)]
///     #[no_ttl_extension]  // opt-out of automatic TTL extension
///     CacheData,
///
///     #[temporary(BytesN<32>)]
///     TempData,
/// }
///
/// // Generated API for instance storage (no extend_ttl method):
/// DataKey::counter(&env)                               // -> Option<u32>
/// DataKey::set_counter(&env, &value)                   // set value
/// DataKey::has_counter(&env)                           // -> bool
/// DataKey::remove_counter(&env)                        // remove entry
/// DataKey::set_or_remove_counter(&env, &opt)           // set if Some, remove if None
///
/// // Generated API for persistent/temporary storage (includes extend_ttl):
/// DataKey::nonce(&env, &user)                          // -> Option<u64>
/// DataKey::set_nonce(&env, &user, &value)
/// DataKey::has_nonce(&env, &user)                      // -> bool
/// DataKey::remove_nonce(&env, &user)
/// DataKey::set_or_remove_nonce(&env, &user, &opt)
/// DataKey::extend_nonce_ttl(&env, &user, threshold, extend_to)  // manual TTL extension
/// ```
///
/// # Storage Types (required, exactly one per variant)
/// - `#[instance(Type)]` - Stored with contract instance (no extend_ttl method generated)
/// - `#[persistent(Type)]` - Durable ledger entries (TTL auto-extended on get/set/has)
/// - `#[temporary(Type)]` - Short-lived entries
///
/// # Variant Attributes (optional)
/// - `#[default(expr)]` - Default value; changes getter return from `Option<T>` to `T`
/// - `#[name("custom")]` - Override the generated function name base
/// - `#[no_ttl_extension]` - Disable automatic TTL extension for this persistent variant
#[proc_macro_attribute]
pub fn storage(_attr: TokenStream, item: TokenStream) -> TokenStream {
    storage::generate_storage(item.into()).into()
}

// ============================================================================
// Error Macro
// ============================================================================

/// Generates a Soroban contract error enum with all required attributes and derives.
///
/// This macro simplifies error enum definitions by automatically adding:
/// - `#[contracterror]` from soroban-sdk for Soroban compatibility
/// - `#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]` for standard error traits
/// - `#[repr(u32)]` for stable ABI representation
///
/// # Discriminant Assignment
///
/// Variants without explicit discriminants are automatically assigned sequential values
/// starting at 1. Explicit discriminants must be strictly increasing.
///
/// # Constraints
///
/// - All variants must be unit variants (no fields)
/// - Explicit discriminants must be valid `u32` integer literals
/// - Each discriminant must be greater than the previous one
///
/// # Examples
///
/// Basic usage with auto-assigned discriminants:
///
/// ```ignore
/// #[contract_error]
/// pub enum MyError {
///     InvalidInput,    // = 1
///     Unauthorized,    // = 2
///     NotFound,        // = 3
/// }
/// ```
///
/// Mixed explicit and auto-assigned discriminants:
///
/// ```ignore
/// #[contract_error]
/// pub enum MyError {
///     InvalidInput,    // = 1
///     Unauthorized,    // = 2
///     NotFound = 10,   // = 10 (explicit)
///     Expired,         // = 11
/// }
/// ```
#[proc_macro_attribute]
pub fn contract_error(_attr: TokenStream, item: TokenStream) -> TokenStream {
    error::generate_error(item.into()).into()
}

// ============================================================================
// Ownable Macro
// ============================================================================

/// Generates ownable implementation with owner-based access control.
///
/// Implements the `Ownable` trait and provides owner initialization and
/// ownership transfer functionality.
///
/// # Example
/// ```ignore
/// #[ownable]
/// pub struct MyContract;
/// ```
///
/// Generated code includes:
/// - `OwnableInitializer` trait impl - Use `<Self as OwnableInitializer>::init_owner(env, owner)` to initialize
/// - `Auth` trait impl - `authorizer(env)` returns the stored owner address
/// - `Ownable` trait impl
#[proc_macro_attribute]
pub fn ownable(_attr: TokenStream, item: TokenStream) -> TokenStream {
    auth::generate_ownable_impl(item.into()).into()
}

// ============================================================================
// MultiSig Macro
// ============================================================================

/// Generates multisig implementation with self-owning access control.
///
/// Implements the `MultiSig` trait and the `Auth` trait with self-owning pattern,
/// where the contract's own address is the authorizer. This allows multisig
/// quorum approval to serve as the authorizer for owner-protected operations
/// like TTL configuration and upgrades.
///
/// # Example
/// ```ignore
/// #[multisig]
/// pub struct MyContract;
/// ```
///
/// Generated code includes:
/// - `Auth` trait impl - `authorizer(env)` returns `env.current_contract_address()`
/// - `MultiSig` trait impl
#[proc_macro_attribute]
pub fn multisig(_attr: TokenStream, item: TokenStream) -> TokenStream {
    auth::generate_multisig_impl(item.into()).into()
}

// ============================================================================
// Only Auth Macro
// ============================================================================

/// Restricts function access to the contract authorizer only.
///
/// This attribute macro injects an auth check at the beginning of the function
/// using the `Auth` trait. The function will panic if called without authorization.
///
/// Works with any contract that implements `Auth`, including both `Ownable` and
/// `MultiSig` contracts.
///
/// # Requirements
/// - The function must have an `Env` parameter (by value or reference)
/// - The containing contract must implement the `Auth` trait
///
/// # Example
/// ```ignore
/// #[ownable]  // or implement `#[multisig]`
/// pub struct MyContract;
///
/// #[soroban_sdk::contractimpl]
/// impl MyContract {
///     #[only_auth]
///     pub fn protected_action(env: Env) {
///         // Only the authorizer can execute this
///     }
/// }
/// ```
///
/// Generated code (conceptual):
/// ```ignore
/// pub fn protected_action(env: Env) {
///     utils::auth::require_auth::<Self>(&env);
///     // Original function body
/// }
/// ```
#[proc_macro_attribute]
pub fn only_auth(_attr: TokenStream, item: TokenStream) -> TokenStream {
    auth::prepend_only_auth_check(item.into()).into()
}

// ============================================================================
// RBAC Macros
// ============================================================================

/// Checks that the given account has the specified role.
///
/// Injects a role check at the start of the function. Panics with
/// `RbacError::Unauthorized` if the account does not have the role (aligns with OpenZeppelin).
///
/// # Security Warning
///
/// **IMPORTANT**: This macro checks role membership but does NOT call
/// `require_auth()`. Use this macro when:
///
/// 1. Your function already contains a `require_auth()` call for the account
/// 2. You need role-based access control without authorization enforcement
///
/// If you need both role checking AND authorization, use `#[only_role]` instead.
///
/// # Requirements
/// - The function must have an `Env` parameter
/// - The function must have a parameter matching the first macro arg (of type `Address` or `&Address`)
/// - The contract must implement `RoleBasedAccessControl` (which extends `Auth`)
///
/// # Example
/// ```ignore
/// #[has_role(caller, "minter")]
/// pub fn mint(env: Env, caller: Address, amount: i128) { ... }
///
/// // Or with a &str constant:
/// const MINTER_ROLE: &str = "minter";
/// #[has_role(caller, MINTER_ROLE)]
/// pub fn mint(env: Env, caller: Address, amount: i128) { ... }
/// ```
///
/// # Generated code
/// ```ignore
/// pub fn mint(env: Env, caller: Address, amount: i128) {
///     utils::rbac::ensure_role::<Self>(&env, &soroban_sdk::Symbol::new(&env, "minter"), &caller);
///     // Original function body (no require_auth)
/// }
/// ```
#[proc_macro_attribute]
pub fn has_role(attr: TokenStream, item: TokenStream) -> TokenStream {
    rbac::generate_role_check(attr.into(), item.into(), false).into()
}

/// Checks that the given account has the specified role and requires auth.
///
/// Same as `#[has_role]` but also calls `account.require_auth()` to ensure
/// the caller has authorized the transaction.
///
/// **IMPORTANT**: This macro both checks role membership AND enforces
/// authorization. In Stellar contracts, duplicate `require_auth()` calls for
/// the same account will cause panics. If your function already contains a
/// `require_auth()` call for the same account, use `#[has_role]` instead to
/// avoid duplicate authorization checks.
///
/// # Requirements
/// Same as `#[has_role]`.
///
/// # Example
/// ```ignore
/// #[only_role(caller, "minter")]
/// pub fn mint(env: Env, caller: Address, amount: i128) { ... }
///
/// // Or with a &str constant: #[only_role(caller, MINTER_ROLE)]
/// ```
///
/// # Generated code
/// ```ignore
/// pub fn mint(env: Env, caller: Address, amount: i128) {
///     utils::rbac::ensure_role::<Self>(&env, &soroban_sdk::Symbol::new(&env, "minter"), &caller);
///     caller.require_auth();
///     // Original function body
/// }
/// ```
#[proc_macro_attribute]
pub fn only_role(attr: TokenStream, item: TokenStream) -> TokenStream {
    rbac::generate_role_check(attr.into(), item.into(), true).into()
}

// ============================================================================
// TTL Configuration Macro
// ============================================================================

/// Generates TtlConfigurable trait implementation.
///
/// This macro implements the `TtlConfigurable` trait for a contract struct,
/// providing TTL configuration management with auth-based access control.
///
/// # Requirements
/// The contract must implement the `Auth` trait (typically via `#[ownable]` or `#[multisig]`).
///
/// # Example
/// ```ignore
/// #[ownable]  // or `#[multisig]` for self-owning contracts
/// #[ttl_configurable]
/// pub struct MyContract;
/// ```
///
/// Generated code includes:
/// - `set_ttl_configs(env, instance, persistent)` - Set TTL configs (auth required)
/// - `ttl_configs(env)` - Get current TTL configs (instance, persistent)
/// - `freeze_ttl_configs(env)` - Permanently freeze TTL configs (auth required)
/// - `is_ttl_configs_frozen(env)` - Check if TTL configs are frozen
#[proc_macro_attribute]
pub fn ttl_configurable(_attr: TokenStream, item: TokenStream) -> TokenStream {
    ttl_configurable::generate_ttl_configurable_impl(item.into()).into()
}

// ============================================================================
// TTL Extendable Macro
// ============================================================================

/// Generates TtlExtendable trait implementation for manual instance TTL extension.
///
/// This macro implements the `TtlExtendable` trait, providing a public
/// `extend_instance_ttl` function that allows external callers to extend
/// the contract's instance storage TTL.
///
/// # Example
/// ```ignore
/// #[contract]
/// #[ttl_extendable]
/// pub struct MyContract;
/// ```
///
/// Generated code includes:
/// - `extend_instance_ttl(env, threshold, extend_to)` - Extends instance TTL
#[proc_macro_attribute]
pub fn ttl_extendable(_attr: TokenStream, item: TokenStream) -> TokenStream {
    ttl_extendable::generate_ttl_extendable_impl(item.into()).into()
}

// ============================================================================
// Contract Impl Macro
// ============================================================================

/// Wraps `#[soroban_sdk::contractimpl]` with automatic instance TTL extension.
///
/// This macro applies `#[soroban_sdk::contractimpl]` and injects TTL extension logic
/// at the beginning of each contract entry function to keep the contract instance alive.
///
/// # Requirements
/// - The contract struct must have `#[ttl_configurable]` applied to provide `ttl_configs()`
/// - Methods must have an `Env` parameter to receive TTL extension
///
/// # Behavior
/// - **Inherent impls** (`impl MyContract`): Only public methods receive TTL extension
/// - **Trait impls** (`impl SomeTrait for MyContract`): All methods receive TTL extension
/// - Methods without an `Env` parameter are skipped
///
/// # Example
/// ```ignore
/// #[contract]
/// #[ttl_configurable]
/// pub struct MyContract;
///
/// #[contract_impl]
/// impl MyContract {
///     pub fn my_method(env: &Env) {
///         // TTL extension is automatically injected here
///         // ... your code
///     }
/// }
/// ```
///
/// Generated code (conceptual):
/// ```ignore
/// #[soroban_sdk::contractimpl]
/// impl MyContract {
///     pub fn my_method(env: &Env) {
///         utils::ttl_configurable::extend_instance_ttl(env);
///         // ... your code
///     }
/// }
/// ```
#[proc_macro_attribute]
pub fn contract_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    contract_ttl::contractimpl_with_ttl(attr.into(), item.into()).into()
}

// ============================================================================
// Contract Trait Macro
// ============================================================================

/// Wraps `#[soroban_sdk::contracttrait]` with automatic instance TTL extension.
///
/// This macro applies `#[soroban_sdk::contracttrait]` and injects TTL extension logic
/// at the beginning of each default trait method to keep the contract instance alive.
///
/// # Requirements
/// - The implementing contract must have `#[ttl_configurable]` applied
/// - Methods must have an `Env` parameter to receive TTL extension
/// - Only methods with default implementations are processed
///
/// # Behavior
/// - All default methods with an `Env` parameter receive TTL extension
/// - Methods without a body (abstract methods) are not modified
/// - Methods without an `Env` parameter are skipped
///
/// # Example
/// ```ignore
/// #[contract_trait]
/// pub trait MyTrait {
///     /// This method will have TTL extension injected
///     fn my_method(env: &Env) {
///         // TTL extension is automatically injected here
///         // ... your code
///     }
///
///     /// Abstract methods are not modified
///     fn abstract_method(env: &Env) -> u32;
/// }
/// ```
///
/// Generated code (conceptual):
/// ```ignore
/// #[soroban_sdk::contracttrait]
/// pub trait MyTrait {
///     fn my_method(env: &Env) {
///         utils::ttl_configurable::extend_instance_ttl(env);
///         // ... your code
///     }
///
///     fn abstract_method(env: &Env) -> u32;
/// }
/// ```
#[proc_macro_attribute]
pub fn contract_trait(attr: TokenStream, item: TokenStream) -> TokenStream {
    contract_ttl::contracttrait_with_ttl(attr.into(), item.into()).into()
}

// ============================================================================
// Upgradeable Macro
// ============================================================================

/// Generates upgradeable implementation using `Upgradeable` or `UpgradeableRbac` traits.
///
/// `Upgradeable` uses Auth directly; `UpgradeableRbac` layers RoleBased
/// access control on top of Auth.
///
/// # Requirements
/// - `Upgradeable` (default): contract must implement `Auth` (via `#[ownable]` or `#[multisig]`)
/// - `UpgradeableRbac` (with `rbac`): contract must implement both `Auth` and `RoleBasedAccessControl` (e.g. from OApp)
/// - By default, requires manual `UpgradeableInternal` implementation
/// - With `no_migration` flag, auto-generates a no-op `UpgradeableInternal` impl
///
/// # Options
/// - `#[upgradeable]` - Implements Upgradeable, requires manual `UpgradeableInternal` (safety by default)
/// - `#[upgradeable(no_migration)]` - Implements Upgradeable, auto-generates no-op `UpgradeableInternal`
/// - `#[upgradeable(rbac)]` - Implements UpgradeableRbac, requires manual `UpgradeableInternal`
/// - `#[upgradeable(rbac, no_migration)]` - Implements UpgradeableRbac, auto-generates no-op `UpgradeableInternal`
///
/// # Example
/// ```ignore
/// // Implements Upgradeable (default)
/// #[ownable]
/// #[upgradeable]
/// pub struct MyContract;
///
/// impl utils::upgradeable::UpgradeableInternal for MyContract {
///     type MigrationData = MyMigrationParams;
///
///     fn __migrate(env: &Env, migration_data: &Self::MigrationData) {
///         // Custom migration logic here
///     }
/// }
///
/// // Implements Upgradeable (no migration)
/// #[ownable]
/// #[upgradeable(no_migration)]
/// pub struct SimpleContract;
///
/// // Implements UpgradeableRbac (layered)
/// #[ownable]
/// #[upgradeable(rbac)]
/// pub struct RbacContract;
///
/// impl utils::upgradeable::UpgradeableInternal for RbacContract {
///     type MigrationData = MyMigrationParams;
///
///     fn __migrate(env: &Env, migration_data: &Self::MigrationData) {
///         // Custom migration logic here
///     }
/// }
///
/// // Implements UpgradeableRbac (no migration)
/// #[ownable]
/// #[upgradeable(rbac, no_migration)]
/// pub struct SimpleRbacContract;
/// ```
///
/// Generated code includes:
/// - `upgrade` / `migrate` - Auth-based or Auth + RoleBased depending on options
/// - `contractmeta!` with `binver` set to the Cargo package version (if not 0.0.0)
#[proc_macro_attribute]
pub fn upgradeable(attr: TokenStream, item: TokenStream) -> TokenStream {
    upgradeable::generate_upgradeable_impl(attr.into(), item.into()).into()
}

// ============================================================================
// LZ Contract Wrapper Macro
// ============================================================================

/// Wrapper macro that combines common LayerZero contract attributes.
///
/// This macro simplifies contract declarations by combining multiple commonly
/// used macros into a single attribute.
///
/// # Default (no options)
/// `#[lz_contract]` generates:
/// - `#[contract]` - Soroban contract
/// - `#[ttl_configurable]` - TTL configuration with auth
/// - `#[ttl_extendable]` - Manual TTL extension
/// - `#[ownable]` - Single-owner access control
///
/// # Options
/// - `upgradeable(...)` - Adds `#[upgradeable(...)]`; content is passed verbatim to the upgradeable macro
/// - `multisig` - Uses `#[multisig]` instead of `#[ownable]`
///
/// # Examples
/// ```ignore
/// // Basic contract with ownable auth
/// #[lz_contract]
/// pub struct EndpointV2;
///
/// // Contract with upgrade support (requires manual UpgradeableInternal)
/// #[lz_contract(upgradeable)]
/// pub struct DVNFeeLib;
///
/// // Contract with upgrade support and no migration (auto no-op impl)
/// #[lz_contract(upgradeable(no_migration))]
/// pub struct DVNFeeLib;
///
/// // Contract with RBAC-based upgrade support
/// #[lz_contract(upgradeable(rbac))]
/// pub struct RbacOft;
///
/// // Contract with multisig auth and upgrade support (no migration)
/// #[lz_contract(multisig, upgradeable(no_migration))]
/// pub struct DVN;
/// ```
#[proc_macro_attribute]
pub fn lz_contract(attr: TokenStream, item: TokenStream) -> TokenStream {
    lz_contract::generate_lz_contract(attr.into(), item.into()).into()
}
