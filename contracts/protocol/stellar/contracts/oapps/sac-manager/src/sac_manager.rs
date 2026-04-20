//! SAC Manager Contract - Manages a Stellar Asset Contract (SAC) as its admin.
//!
//! This contract becomes the admin of a SAC and provides:
//! - Mintable interface for OFT (mint on credit only; OFT burns on the token directly)
//! - Role-based access control operations (clawback, set_admin, set_authorized)
//!
//! ## Trust Model Requirement
//!
//! **The issuer account must be locked (master weight set to 0).** In Stellar classic assets,
//! transfers from/to the issuer are equivalent to minting/burning. The issuer can always mint
//! more tokens and perform other classic operations directly, even when an explicit admin (this
//! contract) is set. If the issuer account is not locked, the RBAC model enforced by this
//! contract can be bypassed, breaking the trust model.
//!
//! ## Authorization Model
//!
//! - **Owner** (via Ownable): The deployer/admin address. Can manage TTL and grant/revoke roles.
//! - **RBAC roles**: Access is enforced by role.
//!   - `ADMIN_MANAGER_ROLE`: set_admin
//!   - `MINTER_ROLE`: mint (e.g. for OFT credit)
//!   - `BLACKLISTER_ROLE`: set_authorized
//!   - `CLAWBACK_ROLE`: clawback

use crate::{interfaces::SACAdminWrapper, storage::SACManagerStorage};
use common_macros::{contract_impl, lz_contract, only_role};
use soroban_sdk::{token::StellarAssetClient, Address, Env};
use utils::rbac::RoleBasedAccessControl;

/// Role that can set the admin
const ADMIN_MANAGER_ROLE: &str = "ADMIN_MANAGER_ROLE";
/// Role that can mint tokens
const MINTER_ROLE: &str = "MINTER_ROLE";
/// Role that can blacklist users
const BLACKLISTER_ROLE: &str = "BLACKLISTER_ROLE";
/// Role that can clawback tokens from users
const CLAWBACK_ROLE: &str = "CLAWBACK_ROLE";

// =========================================================================
// SAC Manager Contract
// =========================================================================

/// SAC Manager Contract
///
/// Manages a SAC as its admin, forwarding token actions to
/// the underlying SAC while enforcing access control.
#[lz_contract]
pub struct SACManager;

#[contract_impl]
impl SACManager {
    /// Constructs the SAC manager contract.
    ///
    /// # Arguments
    /// * `sac_token` - The underlying Stellar Asset Contract address
    /// * `owner` - The initial owner address (for TTL management, role grants)
    pub fn __constructor(env: &Env, sac_token: &Address, owner: &Address) {
        Self::init_owner(env, owner);
        SACManagerStorage::set_sac_token(env, sac_token);
    }

    /// Returns the underlying SAC (Stellar Asset Contract) address.
    pub fn underlying_sac(env: &Env) -> Address {
        SACManagerStorage::sac_token(env).unwrap()
    }
}

#[contract_impl(contracttrait)]
impl SACAdminWrapper for SACManager {
    #[only_role(operator, ADMIN_MANAGER_ROLE)]
    fn set_admin(env: &Env, new_admin: &Address, operator: &Address) {
        sac_client(env).set_admin(new_admin);
    }

    #[only_role(operator, BLACKLISTER_ROLE)]
    fn set_authorized(env: &Env, id: &Address, authorize: bool, operator: &Address) {
        sac_client(env).set_authorized(id, &authorize);
    }

    #[only_role(operator, CLAWBACK_ROLE)]
    fn clawback(env: &Env, from: &Address, amount: i128, operator: &Address) {
        sac_client(env).clawback(from, &amount);
    }

    #[only_role(operator, MINTER_ROLE)]
    fn mint(env: &Env, to: &Address, amount: i128, operator: &Address) {
        sac_client(env).mint(to, &amount);
    }
}

#[contract_impl(contracttrait)]
impl RoleBasedAccessControl for SACManager {}

fn sac_client(env: &Env) -> StellarAssetClient<'_> {
    StellarAssetClient::new(env, &SACManager::underlying_sac(env))
}
