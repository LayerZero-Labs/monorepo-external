//! Policies are permissionless, so binding is the consumer's choice: only this root's
//! DefaultAdmin binds the ACL gate and only the hook authority binds the hook. Any other policy, or
//! its records, never satisfies a manifest bound to ours.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::error::ErrorCode;
use pubkey_policy_interface::{
    pubkey_policy_address, subject_address, PolicyError, PubkeyPolicyMode,
};
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use support::*;
use token_acl_client::instructions as acl;

/// A policy `keeper` creates for `mint`; creation needs no authority over the mint.
fn keeper_policy(f: &Fixture, mint: Pubkey) -> Pubkey {
    f.ok(&[f.init_policy_ix_for(mint, f.keeper, PubkeyPolicyMode::Open)]);
    pubkey_policy_address(&mint, &f.keeper).0
}

fn replace(mut ix: Instruction, from: Pubkey, to: Pubkey) -> Instruction {
    ix.accounts.iter_mut().find(|a| a.pubkey == from).unwrap().pubkey = to;
    ix
}

fn manifests(f: &Fixture) -> [Pubkey; 3] {
    [
        token_acl_interface::get_thaw_extra_account_metas_address(&f.mint, &token_manager::ID),
        token_acl_interface::get_freeze_extra_account_metas_address(&f.mint, &token_manager::ID),
        spl_transfer_hook_interface::get_extra_account_metas_address(
            &f.mint,
            &pubkey_policy_hook::ID,
        ),
    ]
}

/// Another mint's policy never binds: the gate and hook would refuse it on every call, and a hook
/// bound to it would stop the mint's transfers.
#[test]
fn another_mints_policy_does_not_bind() {
    let f = Fixture::new(Mode::AclHook);
    let foreign = keeper_policy(&f, Pubkey::new_unique());
    let before = manifests(&f).map(|key| f.account(&key));
    f.fails(
        &[replace(f.init_acl_ix(), f.policy, foreign)],
        0,
        token_manager::errors::TokenManagerError::WrongPolicyMint,
    );
    f.fails(
        &[replace(f.init_transfer_hook_ix(), f.policy, foreign)],
        0,
        pubkey_policy_hook::errors::HookError::WrongPolicyMint,
    );
    assert_eq!(manifests(&f).map(|key| f.account(&key)), before);
}

#[test]
fn a_rival_policy_for_this_mint_binds_only_through_this_roots_default_admin() {
    let f = Fixture::new(Mode::Acl);
    let rival = keeper_policy(&f, f.mint);
    let before = manifests(&f).map(|key| f.account(&key));
    let mut attack = replace(f.init_acl_ix(), f.policy, rival);
    for meta in &mut attack.accounts {
        if meta.pubkey == f.admin {
            meta.pubkey = f.keeper;
        } else if meta.pubkey
            == role_member(&f.token_manager, token_manager::RoleType::DefaultAdmin, &f.admin)
        {
            meta.pubkey =
                role_member(&f.token_manager, token_manager::RoleType::DefaultAdmin, &f.keeper);
        }
    }
    f.fails(&[attack], 0, ErrorCode::AccountNotInitialized);
    assert_eq!(manifests(&f).map(|key| f.account(&key)), before);
    // Rebinding is the admin's choice, not a property of the policy.
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    f.block(owner, true);
    f.fails(&[f.acl(account, owner, false)], 0, PolicyError::Blocked);
    f.ok(&[replace(f.init_acl_ix(), f.policy, rival)]);
    // The gate now resolves and reads the rival's record (Open: absent record allows).
    let thaw = f.acl(account, owner, false);
    assert!(thaw.accounts.iter().any(|m| m.pubkey == subject_address(&rival, &owner).0));
    assert!(!thaw.accounts.iter().any(|m| m.pubkey == f.record(&owner)));
    f.ok(&[thaw]);
}

#[test]
fn acl_and_hook_reject_a_rival_policys_registry_and_records() {
    for mode in [Mode::Acl, Mode::Hook] {
        let f = Fixture::new(mode);
        let rival = keeper_policy(&f, f.mint);
        let owner = Pubkey::new_unique();
        let destination_owner = Pubkey::new_unique();
        let source = f.create_token(owner);
        let destination = f.create_token(destination_owner);
        f.block(owner, true);
        let original = if matches!(mode, Mode::Acl) {
            f.acl(source, owner, false)
        } else {
            f.mint_to(source, 10);
            f.transfer(source, destination, owner, 1)
        };
        f.fails(std::slice::from_ref(&original), 0, PolicyError::Blocked);
        let before_source = f.account(&source);
        let before_destination = f.account(&destination);
        for replace_policy in [false, true] {
            let mut ix = original.clone();
            for meta in &mut ix.accounts {
                if replace_policy && meta.pubkey == f.policy {
                    meta.pubkey = rival;
                }
                for subject in [owner, destination_owner] {
                    if meta.pubkey == f.record(&subject) {
                        meta.pubkey = subject_address(&rival, &subject).0;
                    }
                }
            }
            f.fails(&[ix], 0, ACCOUNT_RESOLUTION_INCORRECT_ACCOUNT);
            assert_eq!(f.account(&source), before_source);
            assert_eq!(f.account(&destination), before_destination);
        }
    }
}

#[test]
fn managed_acl_cannot_be_rebound_by_any_default_admin_directly() {
    let f = Fixture::new(Mode::Acl);
    let config_before = f.account(&f.mint_config());
    let manifests_before = manifests(&f).map(|key| f.account(&key));
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    let plan = f.acl(account, owner, false);
    for admin in [f.admin, f.keeper] {
        if admin != f.admin {
            f.rotate_default_admin(admin);
        }
        // The Acl signer, not any admin key, is the MintConfig logical admin.
        f.fails(
            &[acl::SetAuthorityBuilder::new()
                .authority(admin)
                .mint_config(f.mint_config())
                .new_authority(Pubkey::new_unique())
                .instruction()],
            0,
            ACL_INVALID_AUTHORITY,
        );
        assert_eq!(f.account(&f.mint_config()), config_before);
        assert_eq!(manifests(&f).map(|key| f.account(&key)), manifests_before);
    }
    f.ok(&[plan]);
}

/// A policy's owner is recorded as the program its records live under, so it must exist before it
/// is bound: an uncreated one would pin the System Program.
#[test]
fn a_policy_must_exist_before_the_gate_or_hook_binds_it() {
    let f = Fixture::new(Mode::AclHook);
    let uncreated = Pubkey::new_unique();
    let before = manifests(&f).map(|key| f.account(&key));
    for ix in [
        replace(f.init_acl_ix(), f.policy, uncreated),
        replace(f.init_transfer_hook_ix(), f.policy, uncreated),
    ] {
        f.fails(&[ix], 0, anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound);
    }
    assert_eq!(manifests(&f).map(|key| f.account(&key)), before);
}
