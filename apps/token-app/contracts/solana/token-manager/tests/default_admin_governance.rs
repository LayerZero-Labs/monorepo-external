//! One rotatable governor; native capabilities and operational grants stay on the manager.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::error::ErrorCode;
use solana_pubkey::Pubkey;
use support::*;
use token_manager::RoleType;

#[test]
fn sole_admin_transfer_requires_nominee_signature_and_supports_cancel_and_replace() {
    let f = Fixture::new(Mode::Plain);
    let original = f.account(&f.token_manager);
    f.fails(
        &[f.accept_default_admin_transfer_ix(f.keeper)],
        0,
        rbac::RbacError::CallerNotPendingAdmin,
    );
    let mut unauthorized = f.begin_default_admin_transfer_ix(f.keeper);
    unauthorized.accounts[0].pubkey = f.operator;
    f.fails(&[unauthorized], 0, rbac::RbacError::Unauthorized);
    f.ok(&[f.begin_default_admin_transfer_ix(f.keeper)]);
    assert_eq!(f.current_admin(), f.admin);
    let mut unsigned = f.accept_default_admin_transfer_ix(f.keeper);
    unsigned.accounts[0].is_signer = false;
    f.fails(&[unsigned], 0, ErrorCode::AccountNotSigner);
    f.ok(&[f.begin_default_admin_transfer_ix(f.operator)]);
    f.fails(
        &[f.accept_default_admin_transfer_ix(f.keeper)],
        0,
        rbac::RbacError::CallerNotPendingAdmin,
    );
    f.ok(&[f.begin_default_admin_transfer_ix(Pubkey::default())]);
    f.fails(
        &[f.accept_default_admin_transfer_ix(f.operator)],
        0,
        rbac::RbacError::CallerNotPendingAdmin,
    );
    assert_eq!(f.account(&f.token_manager), original);
    f.rotate_default_admin(f.keeper);
    assert_eq!(f.current_admin(), f.keeper);
}

#[test]
fn round_trip_rotation_preserves_native_binding_policy_and_explicit_operational_grants() {
    let f = Fixture::new(Mode::AclHook);
    let owner = Pubkey::new_unique();
    let token = f.create_token(owner);
    f.block(owner, true);
    let unchanged = [
        f.mint,
        f.mint_config(),
        f.record(&owner),
        token_acl_interface::get_thaw_extra_account_metas_address(&f.mint, &token_manager::ID),
        token_acl_interface::get_freeze_extra_account_metas_address(&f.mint, &token_manager::ID),
        spl_transfer_hook_interface::get_extra_account_metas_address(
            &f.mint,
            &pubkey_policy_hook::ID,
        ),
    ];
    let before = unchanged.map(|key| f.account(&key));
    f.rotate_default_admin(f.keeper);
    // The previous governor loses configuration/grant authority, not separately granted roles.
    f.fails(&[f.acl_permissions_ix(false, false)], 0, ErrorCode::AccountNotInitialized);
    f.fails(&[f.grant_role_ix(RoleType::Thawer, f.keeper)], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.as_current_admin(f.acl_permissions_ix(false, false))]);
    f.ok(&[f.as_current_admin(f.acl_permissions_ix(true, true))]);
    f.fails(&[f.admin_freeze(token, false, f.keeper)], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.admin_freeze(token, false, f.admin), f.admin_freeze(token, true, f.admin)]);
    f.ok(&[
        f.as_current_admin(f.grant_role_ix(RoleType::Thawer, f.keeper)),
        f.admin_freeze(token, false, f.keeper),
        f.admin_freeze(token, true, f.admin),
        f.revoke_role_ix(RoleType::Thawer, f.admin),
    ]);
    f.rotate_default_admin(f.admin);
    // Returning to A does not recreate a revoked role or any independent authority proposal.
    f.fails(&[f.admin_freeze(token, false, f.admin)], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.admin_freeze(token, false, f.keeper)]);
    assert_eq!(unchanged.map(|key| f.account(&key)), before);
    f.ok(&[f.acl(token, owner, true)]);
    f.fails(&[f.acl(token, owner, false)], 0, pubkey_policy_interface::PolicyError::Blocked);
}

#[test]
fn failed_transaction_rolls_back_admin_rotation_and_role_accounts() {
    let f = Fixture::new(Mode::Acl);
    f.ok(&[f.begin_default_admin_transfer_ix(f.keeper)]);
    let keys = [
        f.token_manager,
        f.mint,
        f.mint_config(),
        role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin),
        role_member(&f.token_manager, RoleType::DefaultAdmin, &f.keeper),
    ];
    let before = keys.map(|key| f.account(&key));
    let accept = f.accept_default_admin_transfer_ix(f.keeper);
    let old_admin_proposal = f.begin_default_admin_transfer_ix(f.operator);
    f.fails(&[accept.clone(), old_admin_proposal], 1, rbac::RbacError::Unauthorized);
    assert_eq!(keys.map(|key| f.account(&key)), before);
    f.ok(&[accept]);
    let accepted = f.account(&f.token_manager);
    f.fails(&[f.accept_default_admin_transfer_ix(f.keeper)], 0, SYSTEM_ACCOUNT_ALREADY_IN_USE);
    assert_eq!(f.account(&f.token_manager), accepted);
}
