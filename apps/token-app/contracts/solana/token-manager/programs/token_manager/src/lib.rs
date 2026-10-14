//! One root (`TokenManagerStore`) per mint: RBAC over the authorities its signer PDAs hold (Token
//! ACL freeze admin, PermissionedBurn, Permanent Delegate, Pause, transfer hook) and the Token ACL
//! permissionless freeze/thaw gate. The pubkey policy the gate reads belongs to the pubkey-policy
//! program and is bound by `init_acl`.

use anchor_lang::prelude::*;
use program_id::declare_program_id;
use spl_discriminator::SplDiscriminate;
use token_acl_interface::instruction::{
    CanFreezePermissionlessInstruction, CanThawPermissionlessInstruction,
};

pub mod authority;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod types;

pub use events::*;
pub use instructions::*;
pub use state::*;
pub use types::*;

declare_program_id!("TOKEN_MANAGER_ID", "79cu2QNvp92chEmBhBgcUfERDT9KHnUcr8eiJb5WzKML");

#[rbac::rbac(state = TokenManagerStore, role_type = RoleType)]
#[program]
pub mod token_manager {
    /// Burner-approved Token-2022 PermissionedBurn, signed by the PB signer; the source authority
    /// must sign independently. Its discriminator is the interface's, a stable consumer ABI.
    #[instruction(discriminator = token_manager_interface::burn::PermissionedBurnInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn permissioned_burn<'info>(
        mut ctx: Context<'info, PermissionedBurn<'info>>,
        amount: u64,
    ) -> Result<()> {
        PermissionedBurn::apply(&mut ctx, amount)
    }

    /// Create the mint's root, authorized by any of its live native authorities (freeze admin,
    /// mint authority, PB authority, Permanent Delegate). No DefaultAdmin exists until
    /// `pending_admin` accepts; acquires no token authority.
    pub fn init_token_manager<'info>(
        mut ctx: Context<'info, InitTokenManager<'info>>,
        params: InitTokenManagerParams,
    ) -> Result<()> {
        InitTokenManager::apply(&mut ctx, &params)
    }

    /// The pending admin signs to become DefaultAdmin; one-time per root.
    pub fn accept_token_manager_admin(mut ctx: Context<AcceptTokenManagerAdmin>) -> Result<()> {
        AcceptTokenManagerAdmin::apply(&mut ctx)
    }

    /// Before acceptance only: the bootstrap native holder re-points the pending admin.
    pub fn set_pending_token_manager_admin<'info>(
        mut ctx: Context<'info, SetPendingTokenManagerAdmin<'info>>,
        pending_admin: Pubkey,
    ) -> Result<()> {
        SetPendingTokenManagerAdmin::apply(&mut ctx, pending_admin)
    }

    /// EVM `burn(from)`: burn from any account as the Permanent Delegate. PdBurner authorizes it;
    /// while the mint has a PB authority, the root's PB signer co-signs as the approval.
    pub fn pd_burn(mut ctx: Context<PdBurn>, amount: u64) -> Result<()> {
        PdBurn::apply(&mut ctx, amount)
    }

    /// EVM `recoverFunds`: move funds out of a frozen account as the Permanent Delegate, leaving it
    /// frozen and the mint's pause state unchanged. Remaining accounts are the transfer hook's.
    pub fn pd_recover<'info>(mut ctx: Context<'info, PdRecover<'info>>, amount: u64) -> Result<()> {
        PdRecover::apply(&mut ctx, amount)
    }

    /// Minter mints `amount` to a token account as this root's Mint signer, which must hold the
    /// mint authority or be one member of a 1-of-n native multisig that does, passed as
    /// `mint_multisig`.
    pub fn mint_to(mut ctx: Context<MintTo>, amount: u64) -> Result<()> {
        MintTo::apply(&mut ctx, amount)
    }

    /// Pauser pauses the mint as this root's Pause signer, which must hold the pause authority or
    /// be one member of a 1-of-n native multisig that does, passed as `pause_multisig`.
    pub fn pause(mut ctx: Context<Pause>) -> Result<()> {
        Pause::apply(&mut ctx)
    }

    /// Unpauser resumes the mint, under the same pause-authority setup as `pause`.
    pub fn unpause(mut ctx: Context<Unpause>) -> Result<()> {
        Unpause::apply(&mut ctx)
    }

    /// Move a signer PDA's native authority to a non-null key. Never renounces.
    pub fn set_native_authority(
        mut ctx: Context<SetNativeAuthority>,
        kind: SignerKind,
        new_authority: Pubkey,
    ) -> Result<()> {
        SetNativeAuthority::apply(&mut ctx, kind, new_authority)
    }

    /// Bind or re-bind the pubkey-policy hook's policy as this root's TransferHook signer, which
    /// must hold the mint's transfer-hook authority.
    pub fn set_transfer_hook_policy(mut ctx: Context<SetTransferHookPolicy>) -> Result<()> {
        SetTransferHookPolicy::apply(&mut ctx)
    }

    /// Create or rewrite both Token ACL gate manifests to bind `pubkey_policy`. Does not register
    /// with Token ACL or change any authority or policy state.
    pub fn init_acl(mut ctx: Context<InitAcl>) -> Result<()> {
        InitAcl::apply(&mut ctx)
    }

    /// Token ACL gate for permissionless thaw: approve an empty account whose owner the bound
    /// policy allows. Token ACL performs the thaw.
    #[instruction(discriminator = CanThawPermissionlessInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn can_thaw_permissionless(ctx: Context<Gate>) -> Result<()> {
        Gate::can_thaw(&ctx)
    }

    /// Token ACL gate for permissionless freeze: approve an empty account whose owner the bound
    /// policy blocks. Token ACL performs the freeze.
    #[instruction(discriminator = CanFreezePermissionlessInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn can_freeze_permissionless(ctx: Context<Gate>) -> Result<()> {
        Gate::can_freeze(&ctx)
    }

    /// Freezer freezes one account through Token ACL, whatever its balance or owner's membership.
    pub fn freeze_token_account(mut ctx: Context<FreezeTokenAccount>) -> Result<()> {
        FreezeTokenAccount::apply(&mut ctx)
    }

    /// Thawer thaws one account through Token ACL, whatever its balance or owner's membership.
    pub fn thaw_token_account(mut ctx: Context<ThawTokenAccount>) -> Result<()> {
        ThawTokenAccount::apply(&mut ctx)
    }

    /// Enable or disable Token ACL's permissionless freeze and thaw for the mint.
    pub fn set_acl_permissions(mut ctx: Context<ManageAcl>, params: AclPermissions) -> Result<()> {
        ManageAcl::permissions(&mut ctx, params)
    }

    /// Point the mint's Token ACL config at another gating program. `Pubkey::default()` leaves no
    /// gate, so permissionless thaw and freeze can never succeed; prefer `set_acl_permissions` to
    /// turn them off.
    pub fn set_acl_gating_program(
        mut ctx: Context<ManageAcl>,
        gating_program: Pubkey,
    ) -> Result<()> {
        ManageAcl::gating_program(&mut ctx, gating_program)
    }

    /// View: the account-layout and IDL versions this build speaks.
    pub fn get_version(
        _ctx: Context<GetVersion>,
    ) -> Result<token_manager_interface::ProgramVersion> {
        Ok(token_manager_interface::TOKEN_MANAGER_VERSION)
    }
}
