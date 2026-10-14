//! Real SBF pubkey policy -> upstream ACL -> custom gate -> Token-2022 execution.
#[path = "support/mod.rs"]
mod support;

use pubkey_policy_interface::PolicyError;
use solana_pubkey::Pubkey;
use spl_token_2022::{error::TokenError, state::AccountState};
use support::*;
use token_manager::errors::TokenManagerError;

#[test]
fn foreign_owned_records_fail_in_sbf_gate() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    let token = f.create_token(owner);
    // A record must assert something to exist, so whitelist rather than clear an unset bit.
    f.ok(&[f.whitelist_ix(owner, true)]);
    let record = f.record(&owner);
    let original = f.account(&record);
    let plan = f.acl(token, owner, false);
    let mut foreign = original.clone();
    foreign.owner = SYSTEM;
    f.context.account_store.borrow_mut().insert(record, foreign);
    f.fails(std::slice::from_ref(&plan), 0, PolicyError::WrongOwner);
    assert_eq!(f.token(&token).state, AccountState::Frozen);
    f.context.account_store.borrow_mut().insert(record, original);
    f.ok(&[plan]);
}

#[test]
fn acl_token_lifecycle_with_pubkey_blocking_and_no_hook() {
    let f = Fixture::new(Mode::Acl);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
    f.ok(&[f.acl(source, alice, false), f.acl(destination, bob, false)]);
    f.mint_to(source, 100);
    f.ok(&[f.transfer(source, destination, alice, 10)]);
    assert_eq!(f.token(&destination).amount, 10);

    f.block(alice, true);
    assert!(membership(&f.account(&f.record(&alice)).data).unwrap().blacklisted);
    // The token manager store does not magically freeze already-thawed native accounts.
    f.ok(&[f.transfer(source, destination, alice, 1)]);
    // Permissionless freeze only re-seals the new-account frontier. A funded account holds value,
    // so sealing it is the Freezer role's decision, never the public's.
    f.fails(&[f.acl(source, alice, true)], 0, TokenManagerError::NonEmptyAccount);
    f.ok(&[f.admin_freeze(source, true, f.admin)]);
    f.fails(&[f.transfer(source, destination, alice, 1)], 0, TokenError::AccountFrozen as u32);
    f.fails(&[f.acl(source, alice, false)], 0, PolicyError::Blocked);
    assert_eq!(f.token(&source).state, AccountState::Frozen);

    f.block(alice, false);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
    f.fails(&[f.acl(source, alice, false)], 0, TokenManagerError::NonEmptyAccount);
    f.ok(&[f.admin_freeze(source, false, f.admin), f.transfer(source, destination, alice, 9)]);
    assert_eq!(f.token(&source).amount, 80);
    assert_eq!(f.token(&destination).amount, 20);
}

#[test]
fn preemptive_block_covers_new_auxiliaries_and_new_account_thaw_resolves_before_creation() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    f.block(owner, true); // Owner has no account and no token accounts yet.
    for _ in 0..2 {
        let address = f.create_token(owner);
        f.fails(&[f.acl(address, owner, false)], 0, PolicyError::Blocked);
    }
    f.block(owner, false);
    let new_account = Pubkey::new_unique();
    let mut instructions = f.create_token_ixs(new_account, owner);
    // Upstream resolver reads only existing manifest/config; this account is absent.
    instructions.push(f.acl(new_account, owner, false));
    f.ok(&instructions);
    assert_eq!(f.token(&new_account).state, AccountState::Initialized);
}

#[test]
fn empty_admin_frozen_account_can_activate_but_funded_account_requires_admin_thaw() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    f.ok(&[f.acl(account, owner, false)]);
    f.fails(&[f.acl(account, owner, true)], 0, PolicyError::NotBlocked);
    f.ok(&[f.admin_freeze(account, true, f.admin)]);
    assert_eq!(f.token(&account).state, AccountState::Frozen);
    f.ok(&[f.acl(account, owner, false)]);
    assert_eq!(f.token(&account).state, AccountState::Initialized);
    f.mint_to(account, 1);
    f.ok(&[f.admin_freeze(account, true, f.admin)]);
    f.fails(&[f.acl(account, owner, false)], 0, TokenManagerError::NonEmptyAccount);
    // Administrative thaw is discretionary, including when policy denies the owner.
    f.block(owner, true);
    f.ok(&[f.admin_freeze(account, false, f.admin)]);
    assert_eq!(f.token(&account).amount, 1);
}

#[test]
fn blocked_thaw_rolls_back_a_new_token_account_transaction() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    f.block(owner, true);
    let address = Pubkey::new_unique();
    let before = f.account(&f.admin);
    let mut instructions = f.create_token_ixs(address, owner);
    instructions.push(f.acl(address, owner, false));
    f.fails(&instructions, 2, PolicyError::Blocked);
    assert!(f.account(&address).data.is_empty());
    assert_eq!(f.account(&f.admin), before);
}

#[test]
fn ata_creation_and_activation_compose_and_live_funding_invalidates_an_old_thaw_plan() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    let address = spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
        &owner, &f.mint, &mollusk_svm_programs_token::token2022::ID);
    let create =
        spl_associated_token_account_interface::instruction::create_associated_token_account(
            &f.admin,
            &owner,
            &f.mint,
            &mollusk_svm_programs_token::token2022::ID,
        );
    let planned_thaw = f.acl(address, owner, false);
    f.ok(&[create, planned_thaw.clone()]);
    assert_eq!(f.token(&address).state, AccountState::Initialized);
    f.mint_to(address, 1);
    f.ok(&[f.admin_freeze(address, true, f.admin)]);
    f.fails(&[planned_thaw], 0, TokenManagerError::NonEmptyAccount);
    assert_eq!(f.token(&address).state, AccountState::Frozen);
}

#[test]
fn permissionless_plan_cannot_substitute_an_allowed_owners_record() {
    let f = Fixture::new(Mode::Acl);
    let blocked = Pubkey::new_unique();
    let allowed = Pubkey::new_unique();
    let account = f.create_token(blocked);
    f.block(blocked, true);
    // Allocate the allowed subject's record without asserting a cleared bit.
    f.ok(&[f.whitelist_ix(allowed, true)]);
    let mut ix = f.acl(account, blocked, false);
    ix.accounts
        .iter_mut()
        .find(|meta| meta.pubkey == f.record(&blocked))
        .unwrap()
        .pubkey = f.record(&allowed);
    f.fails(&[ix], 0, ACCOUNT_RESOLUTION_INCORRECT_ACCOUNT);
    assert_eq!(f.token(&account).state, AccountState::Frozen);
}
