//! Permissionless pubkey-policy oracle: anyone creates a policy for a mint and names its admin;
//! consumers bind the one they accept.

use anchor_lang::prelude::*;
use program_id::declare_program_id;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod types;

pub use events::*;
pub use instructions::*;
pub use pubkey_policy_interface::{PubkeyPolicy, PubkeyPolicyMode};
pub use types::*;

declare_program_id!("PUBKEY_POLICY_ID", "AbtWNPXHcppLsNV6Y2uZYmqD5uAN8BBPKGngqvniFu3U");

#[rbac::rbac(state = PubkeyPolicy, role_type = RoleType)]
#[program]
pub mod pubkey_policy {

    /// Permissionless: create `initializer`'s policy for `mint` and name its DefaultAdmin.
    pub fn init_pubkey_policy(
        mut ctx: Context<InitPubkeyPolicy>,
        params: InitPubkeyPolicyParams,
    ) -> Result<()> {
        InitPubkeyPolicy::apply(&mut ctx, &params)
    }

    /// Update blacklist membership without changing whitelist membership.
    pub fn set_blacklisted(
        mut ctx: Context<SetBlacklisted>,
        params: SetBlacklistedParams,
    ) -> Result<()> {
        SetBlacklisted::apply(&mut ctx, &params)
    }

    /// Update whitelist membership without changing blacklist membership.
    pub fn set_whitelisted(
        mut ctx: Context<SetWhitelisted>,
        params: SetWhitelistedParams,
    ) -> Result<()> {
        SetWhitelisted::apply(&mut ctx, &params)
    }

    /// Change the live pubkey predicate. Memberships are kept.
    pub fn set_mode(mut ctx: Context<SetMode>, mode: PubkeyPolicyMode) -> Result<()> {
        SetMode::apply(&mut ctx, mode)
    }

    /// View: the account-layout and IDL versions this build speaks.
    pub fn get_version(
        _ctx: Context<GetVersion>,
    ) -> Result<pubkey_policy_interface::ProgramVersion> {
        Ok(pubkey_policy_interface::PUBKEY_POLICY_VERSION)
    }
}
