use crate::{
    errors::WorkerError,
    events::{
        Paused, SetAdmin, SetAllowlist, SetDefaultMultiplierBps, SetDenylist, SetDepositAddress, SetPriceFeed,
        SetSupportedMessageLib, SetSupportedOptionTypes, SetWorkerFeeLib, Unpaused,
    },
    storage::WorkerStorage,
};
use common_macros::{contract_trait, only_auth};
use soroban_sdk::{assert_with_error, panic_with_error, Address, Env, Vec};
use utils::auth::Auth;

/// Worker interface providing common functionality for LayerZero workers.
///
/// Requires the `Auth` trait to be implemented, which can be provided by either:
/// - `#[ownable]` macro for single-owner contracts (e.g., Executor)
/// - `#[multisig]` macro for multisig-controlled contracts (e.g., DVN)
#[contract_trait]
pub trait Worker: Auth {
    // ========================================================================
    // Manager Functions
    // ========================================================================

    /// Sets the paused state of the worker.
    ///
    /// When paused, the worker will reject new job assignments (e.g., assign_job, get_fee).
    /// Existing jobs in progress are not affected.
    ///
    /// # Arguments
    /// * `paused` - `true` to pause, `false` to unpause
    #[only_auth]
    fn set_paused(env: &soroban_sdk::Env, paused: bool) {
        assert_with_error!(env, Self::paused(env) != paused, WorkerError::PauseStatusUnchanged);

        let authorizer = Self::authorizer(env).unwrap();
        WorkerStorage::set_paused(env, &paused);
        if paused {
            Paused { pauser: authorizer }.publish(env);
        } else {
            Unpaused { unpauser: authorizer }.publish(env);
        }
    }

    /// Sets admin status for an address.
    ///
    /// Admins can configure worker settings like fee multipliers, deposit addresses,
    /// and supported option types.
    ///
    /// **Address type requirement:** Admins used for execute/compose flows (Executor)
    /// or custom account auth (DVN) must be Ed25519 accounts. Contract-type addresses
    /// cannot participate in custom account authorization. Only Ed25519 account
    /// addresses can sign for execute/compose and DVN admin operations. Contract-type
    /// admins are not supported for these flows;
    ///
    /// # Arguments
    /// * `admin` - The address to set admin status for
    /// * `active` - `true` to add admin, `false` to remove
    #[only_auth]
    fn set_admin(env: &soroban_sdk::Env, admin: &soroban_sdk::Address, active: bool) {
        set_admin_no_auth::<Self>(env, admin, active);
    }

    /// Sets whether a message library is supported by this worker.
    ///
    /// Message libraries (e.g., ULN302) call workers to assign jobs. Only supported
    /// libraries can interact with this worker.
    ///
    /// # Arguments
    /// * `message_lib` - The message library contract address
    /// * `supported` - `true` to add support, `false` to remove support
    #[only_auth]
    fn set_supported_message_lib(env: &soroban_sdk::Env, message_lib: &soroban_sdk::Address, supported: bool) {
        set_message_lib_no_auth::<Self>(env, message_lib, supported);
    }

    /// Sets allowlist status for an OApp address.
    ///
    /// When the allowlist is empty, all OApps are allowed (unless on denylist).
    /// When the allowlist is not empty, only allowlisted OApps are allowed.
    /// Denylist always takes precedence over allowlist.
    ///
    /// # Arguments
    /// * `oapp` - The OApp contract address
    /// * `allowed` - `true` to add to allowlist, `false` to remove
    #[only_auth]
    fn set_allowlist(env: &soroban_sdk::Env, oapp: &soroban_sdk::Address, allowed: bool) {
        let is_on_list = Self::is_on_allowlist(env, oapp);
        if allowed {
            // Add to allowlist - ensure not already present
            assert_with_error!(env, !is_on_list, WorkerError::AlreadyOnAllowlist);
            WorkerStorage::set_allowlist(env, oapp, &true);
            // Increment allowlist size
            let size = Self::allowlist_size(env);
            WorkerStorage::set_allowlist_size(env, &(size + 1));
        } else {
            // Remove from allowlist - ensure present
            assert_with_error!(env, is_on_list, WorkerError::NotOnAllowlist);
            WorkerStorage::remove_allowlist(env, oapp);
            // Decrement allowlist size
            let size = Self::allowlist_size(env);
            WorkerStorage::set_allowlist_size(env, &(size - 1));
        }
        SetAllowlist { oapp: oapp.clone(), allowed }.publish(env);
    }

    /// Sets denylist status for an OApp address.
    ///
    /// Denylisted OApps are blocked from using this worker, even if they're on
    /// the allowlist (denylist takes precedence).
    ///
    /// # Arguments
    /// * `oapp` - The OApp contract address
    /// * `denied` - `true` to add to denylist, `false` to remove
    #[only_auth]
    fn set_denylist(env: &soroban_sdk::Env, oapp: &soroban_sdk::Address, denied: bool) {
        let is_on_list = Self::is_on_denylist(env, oapp);

        if denied {
            // Add to denylist - ensure not already present
            assert_with_error!(env, !is_on_list, WorkerError::AlreadyOnDenylist);
            WorkerStorage::set_denylist(env, oapp, &true);
        } else {
            // Remove from denylist - ensure present
            assert_with_error!(env, is_on_list, WorkerError::NotOnDenylist);
            WorkerStorage::remove_denylist(env, oapp);
        }
        SetDenylist { oapp: oapp.clone(), denied }.publish(env);
    }

    // ========================================================================
    // Admin(managed by the manager) Functions
    // ========================================================================

    /// Sets the default fee multiplier in basis points.
    ///
    /// The multiplier is applied to base fees during fee calculation. Used when
    /// no destination-specific multiplier is configured.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must provide authorization)
    /// * `multiplier_bps` - Multiplier in basis points (10000 = 1x, 12000 = 1.2x)
    fn set_default_multiplier_bps(env: &soroban_sdk::Env, admin: &soroban_sdk::Address, multiplier_bps: u32) {
        require_admin_auth::<Self>(env, admin);
        set_default_multiplier_bps_no_auth(env, multiplier_bps);
    }

    /// Sets the deposit address where worker fees are collected.
    ///
    /// When jobs are assigned, fees are directed to this address.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must provide authorization)
    /// * `deposit_address` - Address to receive collected fees
    fn set_deposit_address(
        env: &soroban_sdk::Env,
        admin: &soroban_sdk::Address,
        deposit_address: &soroban_sdk::Address,
    ) {
        require_admin_auth::<Self>(env, admin);
        set_deposit_address_no_auth(env, deposit_address);
    }

    /// Sets supported executor option types for a destination endpoint.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must provide authorization)
    /// * `eid` - Destination endpoint ID (chain identifier)
    /// * `option_types` - Supported option types. Each byte represents an option type.
    fn set_supported_option_types(
        env: &soroban_sdk::Env,
        admin: &soroban_sdk::Address,
        eid: u32,
        option_types: &soroban_sdk::Bytes,
    ) {
        require_admin_auth::<Self>(env, admin);
        WorkerStorage::set_supported_option_types(env, eid, option_types);
        SetSupportedOptionTypes { dst_eid: eid, option_types: option_types.clone() }.publish(env);
    }

    /// Sets the worker fee library contract address.
    ///
    /// The fee library calculates fees based on executor options and price feed data.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must provide authorization)
    /// * `worker_fee_lib` - Fee library contract address implementing `IExecutorFeeLib`
    fn set_worker_fee_lib(env: &soroban_sdk::Env, admin: &soroban_sdk::Address, worker_fee_lib: &soroban_sdk::Address) {
        require_admin_auth::<Self>(env, admin);
        set_worker_fee_lib_no_auth(env, worker_fee_lib);
    }

    /// Sets the price feed contract address.
    ///
    /// The price feed provides gas prices and exchange rates for cross-chain
    /// fee calculations.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must provide authorization)
    /// * `price_feed` - Price feed contract address implementing `ILayerZeroPriceFeed`
    fn set_price_feed(env: &soroban_sdk::Env, admin: &soroban_sdk::Address, price_feed: &soroban_sdk::Address) {
        require_admin_auth::<Self>(env, admin);
        set_price_feed_no_auth(env, price_feed);
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    /// Returns whether the worker is paused.
    fn paused(env: &soroban_sdk::Env) -> bool {
        WorkerStorage::paused(env)
    }

    /// Returns whether an address is an admin.
    ///
    /// # Arguments
    /// * `admin` - The address to check
    fn is_admin(env: &soroban_sdk::Env, admin: &soroban_sdk::Address) -> bool {
        Self::admins(env).contains(admin)
    }

    /// Returns all admin addresses.
    fn admins(env: &soroban_sdk::Env) -> soroban_sdk::Vec<soroban_sdk::Address> {
        WorkerStorage::admins(env)
    }

    /// Returns whether a message library is supported.
    ///
    /// # Arguments
    /// * `message_lib` - Message library contract address
    fn is_supported_message_lib(env: &soroban_sdk::Env, message_lib: &soroban_sdk::Address) -> bool {
        Self::message_libs(env).contains(message_lib)
    }

    /// Returns all supported message library addresses.
    ///
    /// # Returns
    /// Vector of supported message library contract addresses.
    fn message_libs(env: &soroban_sdk::Env) -> soroban_sdk::Vec<soroban_sdk::Address> {
        WorkerStorage::message_libs(env)
    }

    /// Returns whether an OApp is on the allowlist.
    ///
    /// # Arguments
    /// * `oapp` - OApp contract address
    fn is_on_allowlist(env: &soroban_sdk::Env, oapp: &soroban_sdk::Address) -> bool {
        WorkerStorage::has_allowlist(env, oapp)
    }

    /// Returns the number of addresses on the allowlist.
    fn allowlist_size(env: &soroban_sdk::Env) -> u32 {
        WorkerStorage::allowlist_size(env)
    }

    /// Returns whether an OApp is on the denylist.
    ///
    /// # Arguments
    /// * `oapp` - OApp contract address
    fn is_on_denylist(env: &soroban_sdk::Env, oapp: &soroban_sdk::Address) -> bool {
        WorkerStorage::has_denylist(env, oapp)
    }

    /// Returns whether an OApp has access control list (ACL) permission.
    ///
    /// ACL evaluation order:
    /// 1. If on denylist → denied
    /// 2. If allowlist is empty OR on allowlist → allowed
    /// 3. Otherwise → denied
    ///
    /// # Arguments
    /// * `oapp` - OApp contract address to check
    fn has_acl(env: &soroban_sdk::Env, oapp: &soroban_sdk::Address) -> bool {
        !Self::is_on_denylist(env, oapp) && (Self::allowlist_size(env) == 0 || Self::is_on_allowlist(env, oapp))
    }

    /// Returns the default fee multiplier in basis points.
    fn default_multiplier_bps(env: &soroban_sdk::Env) -> u32 {
        WorkerStorage::default_multiplier_bps(env)
    }

    /// Returns the deposit address where fees are collected.
    fn deposit_address(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
        WorkerStorage::deposit_address(env)
    }

    /// Returns supported option types for a destination endpoint.
    ///
    /// # Arguments
    /// * `eid` - Destination endpoint ID (chain identifier)
    fn get_supported_option_types(env: &soroban_sdk::Env, eid: u32) -> Option<soroban_sdk::Bytes> {
        WorkerStorage::supported_option_types(env, eid)
    }

    /// Returns the worker fee library contract address.
    fn worker_fee_lib(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
        WorkerStorage::worker_fee_lib(env)
    }

    /// Returns the price feed contract address.
    fn price_feed(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
        WorkerStorage::price_feed(env)
    }
}

// ============================================================================================
// Worker Initializer
// ============================================================================================

/// Initializes a worker contract with configuration.
///
/// This function should be called only once to initialize the worker once.
///
/// # Arguments
/// * `admins` - Initial admin addresses (must not be empty). Admins used for
///   execute/compose or custom account auth must be Ed25519 (see `set_admin`).
/// * `message_libs` - Supported message library addresses
/// * `price_feed` - Price feed contract address
/// * `default_multiplier_bps` - Default fee multiplier in basis points
/// * `worker_fee_lib` - Worker fee library contract address
/// * `deposit_address` - Address to receive fee payments
pub fn init_worker<T: Worker>(
    env: &Env,
    admins: &Vec<Address>,
    message_libs: &Vec<Address>,
    price_feed: &Address,
    default_multiplier_bps: u32,
    worker_fee_lib: &Address,
    deposit_address: &Address,
) {
    admins.iter().for_each(|admin| set_admin_no_auth::<T>(env, &admin, true));
    message_libs.iter().for_each(|lib| set_message_lib_no_auth::<T>(env, &lib, true));

    set_price_feed_no_auth(env, price_feed);
    set_default_multiplier_bps_no_auth(env, default_multiplier_bps);
    set_worker_fee_lib_no_auth(env, worker_fee_lib);
    set_deposit_address_no_auth(env, deposit_address);
}

// ============================================================================================
// Assert Helper Functions
// ============================================================================================

/// Requires admin authorization for the given address.
///
/// # Arguments
/// * `admin` - The address to check for admin status
///
/// # Errors
/// * `Unauthorized` - If the address is not an admin or authorization fails.
pub fn require_admin_auth<T: Worker>(env: &Env, admin: &Address) {
    admin.require_auth();
    assert_with_error!(env, T::is_admin(env, admin), WorkerError::Unauthorized);
}

/// Asserts that an OApp has ACL permission, panics otherwise.
///
/// # Arguments
/// * `sender` - OApp contract address to check
///
/// # Errors
/// * `NotAllowed` - If the OApp is not allowed to use this worker.
pub fn assert_acl<T: Worker>(env: &Env, sender: &Address) {
    assert_with_error!(env, T::has_acl(env, sender), WorkerError::NotAllowed);
}

/// Asserts that the worker is not paused, panics otherwise.
///
/// # Errors
/// * `WorkerIsPaused` - If the worker is currently paused.
pub fn assert_not_paused<T: Worker>(env: &Env) {
    assert_with_error!(env, !T::paused(env), WorkerError::WorkerIsPaused);
}

/// Asserts that a message library is supported, panics otherwise.
///
/// # Arguments
/// * `message_lib` - Message library contract address to check
///
/// # Errors
/// * `UnsupportedMessageLib` - If the message library is not supported.
pub fn assert_supported_message_lib<T: Worker>(env: &Env, message_lib: &Address) {
    assert_with_error!(env, T::is_supported_message_lib(env, message_lib), WorkerError::UnsupportedMessageLib);
}

// ============================================================================================
// Admin Setter Functions with authentication
// ============================================================================================

/// Sets admin status for an address by admin.
///
/// # Arguments
/// * `caller` - The admin calling this function (must provide authorization)
/// * `admin` - The address to set admin status for
/// * `active` - `true` to add admin, `false` to remove
pub fn set_admin_by_admin<T: Worker>(env: &Env, caller: &Address, admin: &Address, active: bool) {
    require_admin_auth::<T>(env, caller);
    set_admin_no_auth::<T>(env, admin, active);
}

// ============================================================================================
// Internal Functions
// ============================================================================================

/// Sets admin status for an address without authentication.
///
/// Adds or removes an admin from the admin list and updates storage.
///
/// # Arguments
/// * `admin` - Address to set admin status for
/// * `active` - `true` to add admin, `false` to remove
fn set_admin_no_auth<T: Worker>(env: &Env, admin: &Address, active: bool) {
    let mut admins = T::admins(env);

    if active {
        // Add admin - ensure not already active
        assert_with_error!(env, !admins.contains(admin), WorkerError::AdminAlreadyExists);
        admins.push_back(admin.clone());
    } else {
        // Remove admin - ensure present
        let Some(index) = admins.first_index_of(admin) else {
            panic_with_error!(env, WorkerError::AdminNotFound);
        };
        admins.remove(index);
    }
    WorkerStorage::set_admins(env, &admins);
    SetAdmin { admin: admin.clone(), active }.publish(env);
}

/// Sets message library support status without authentication.
///
/// Adds or removes a message library from the supported libraries list.
///
/// # Arguments
/// * `message_lib` - Message library contract address
/// * `supported` - `true` to add support, `false` to remove
fn set_message_lib_no_auth<T: Worker>(env: &Env, message_lib: &Address, supported: bool) {
    let mut libs = T::message_libs(env);

    if supported {
        // Add message lib - ensure not already supported
        assert_with_error!(env, !libs.contains(message_lib), WorkerError::MessageLibAlreadySupported);
        libs.push_back(message_lib.clone());
    } else {
        // Remove message lib - ensure present
        let Some(index) = libs.first_index_of(message_lib) else {
            panic_with_error!(env, WorkerError::MessageLibNotSupported);
        };
        libs.remove(index);
    }
    WorkerStorage::set_message_libs(env, &libs);
    SetSupportedMessageLib { message_lib: message_lib.clone(), supported }.publish(env);
}

/// Sets the deposit address without authentication.
///
/// # Arguments
/// * `deposit_address` - Address to receive collected fees
fn set_deposit_address_no_auth(env: &Env, deposit_address: &Address) {
    WorkerStorage::set_deposit_address(env, deposit_address);
    SetDepositAddress { deposit_address: deposit_address.clone() }.publish(env);
}

/// Sets the worker fee library contract address without authentication.
///
/// # Arguments
/// * `worker_fee_lib` - Fee library contract address
fn set_worker_fee_lib_no_auth(env: &Env, worker_fee_lib: &Address) {
    WorkerStorage::set_worker_fee_lib(env, worker_fee_lib);
    SetWorkerFeeLib { fee_lib: worker_fee_lib.clone() }.publish(env);
}

/// Sets the price feed contract address without authentication.
///
/// # Arguments
/// * `price_feed` - Price feed contract address
fn set_price_feed_no_auth(env: &Env, price_feed: &Address) {
    WorkerStorage::set_price_feed(env, price_feed);
    SetPriceFeed { price_feed: price_feed.clone() }.publish(env);
}

/// Sets the default fee multiplier in basis points without authentication.
///
/// # Arguments
/// * `default_multiplier_bps` - Default multiplier in basis points (10000 = 1x)
fn set_default_multiplier_bps_no_auth(env: &Env, multiplier_bps: u32) {
    WorkerStorage::set_default_multiplier_bps(env, &multiplier_bps);
    SetDefaultMultiplierBps { multiplier_bps }.publish(env);
}
