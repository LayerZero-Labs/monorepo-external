//! Real SBF pubkey policy -> Token-2022 transfer -> optional hook execution, no ACL/DAS.
#[path = "support/mod.rs"]
mod support;

use mollusk_svm_programs_token::token2022;
use pubkey_policy_interface::{PolicyError, PubkeyPolicyMode};
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{
    error::TokenError, extension::transfer_hook::instruction as hook, instruction as token,
    state::AccountState,
};
use support::*;

/// The manifest is inert until the mint names this hook, so the hook authority can stage it while
/// the mint still points at another hook program.
#[test]
fn init_transfer_hook_stages_a_manifest_before_the_mint_names_this_hook() {
    let f = Fixture::uninitialized(Mode::Hook);
    f.ok(&[
        f.init_policy_ix(f.admin, PubkeyPolicyMode::Blacklist),
        hook::update(&token2022::ID, &f.mint, &f.admin, &[], Some(Pubkey::new_unique())).unwrap(),
    ]);
    f.ok(&[f.init_transfer_hook_ix()]);
    let manifest = spl_transfer_hook_interface::get_extra_account_metas_address(
        &f.mint,
        &pubkey_policy_hook::ID,
    );
    assert_eq!(f.account(&manifest).owner, pubkey_policy_hook::ID);
}

#[test]
fn exhausting_a_delegate_allowance_still_checks_the_actual_authority() {
    let f = Fixture::new(Mode::Hook);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    f.mint_to(source, 30);
    let approve = token::approve_checked(
        &token2022::ID,
        &source,
        &f.mint,
        &f.operator,
        &alice,
        &[],
        10,
        DECIMALS,
    )
    .unwrap();
    let delegated = f.transfer(source, destination, f.operator, 10);

    f.ok(std::slice::from_ref(&approve));
    f.ok(std::slice::from_ref(&delegated));
    assert!(f.token(&source).delegate.is_none());
    assert_eq!(f.token(&source).delegated_amount, 0);
    assert_eq!(f.token(&destination).amount, 10);

    f.ok(&[approve]);
    f.block(f.operator, true);
    let before_source = f.account(&source);
    let before_destination = f.account(&destination);
    // Token-2022 clears source.delegate before invoking the hook. Checking that
    // field instead of authority would miss the block on this final transfer.
    f.fails(&[delegated], 0, PolicyError::Blocked);
    assert_eq!(f.account(&source), before_source);
    assert_eq!(f.account(&destination), before_destination);
}

#[test]
fn a_blocked_idle_delegate_does_not_block_the_owners_transfer() {
    let f = Fixture::new(Mode::Hook);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    f.mint_to(source, 30);
    f.ok(&[token::approve_checked(
        &token2022::ID,
        &source,
        &f.mint,
        &f.operator,
        &alice,
        &[],
        10,
        DECIMALS,
    )
    .unwrap()]);
    f.block(f.operator, true);

    f.ok(&[f.transfer(source, destination, alice, 10)]);
    assert!(f.token(&source).delegate.contains(&f.operator));
    assert_eq!(f.token(&source).delegated_amount, 10);
    f.fails(&[f.transfer(source, destination, f.operator, 10)], 0, PolicyError::Blocked);
    assert_eq!(f.token(&source).amount, 20);
    assert_eq!(f.token(&destination).amount, 10);
}

/// Token-2022 passes the delegate as the transfer authority, so the hook must also check the
/// source owner's record: a blocked owner's approved delegate cannot move its tokens.
#[test]
fn a_blocked_owners_delegate_cannot_move_its_tokens() {
    let f = Fixture::new(Mode::Hook);
    let alice = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(Pubkey::new_unique());
    f.mint_to(source, 100);
    f.ok(&[token::approve_checked(
        &token2022::ID,
        &source,
        &f.mint,
        &f.operator,
        &alice,
        &[],
        50,
        DECIMALS,
    )
    .unwrap()]);
    let delegated = f.transfer(source, destination, f.operator, 10);
    f.ok(std::slice::from_ref(&delegated));
    f.block(alice, true);
    f.fails(&[delegated], 0, PolicyError::Blocked);
}

#[test]
fn one_pubkey_record_covers_multiple_auxiliaries_and_a_program_pda_owner() {
    let f = Fixture::new(Mode::Hook);
    let program = Pubkey::new_unique();
    let owner = Pubkey::find_program_address(&[b"vault"], &program).0;
    let alice = Pubkey::new_unique();
    let source = f.create_token(alice);
    let a = f.create_token(owner);
    let b = f.create_token(owner);
    f.mint_to(source, 100);
    f.ok(&[f.transfer(source, a, alice, 1), f.transfer(source, b, alice, 1)]);
    f.block(owner, true);
    for account in [a, b] {
        f.fails(&[f.transfer(source, account, alice, 1)], 0, PolicyError::Blocked);
    }
    f.block(owner, false);
    f.ok(&[f.transfer(source, b, alice, 1)]);
}

#[test]
/// The mint's permanent delegate is exempt from the hook even for a blocked owner. Here it is a
/// wallet, not the TokenManager's PD signer, so native freeze/thaw is composed around it.
fn permanent_delegate_is_exempt_from_the_hook_even_for_a_blocked_owner() {
    let f = Fixture::new(Mode::Hook);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    f.mint_to(source, 100);
    // No legacy restriction on native PD powers for an unblocked owner.
    f.ok(&[f.transfer(source, destination, f.admin, 1)]);
    f.block(alice, true);
    f.ok(&[f.native_freeze(source, true)]);
    f.fails(&[f.transfer(source, destination, f.admin, 10)], 0, TokenError::AccountFrozen as u32);
    f.ok(&[
        f.native_freeze(source, false),
        f.transfer(source, destination, f.admin, 10),
        f.native_freeze(source, true),
    ]);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
    assert_eq!(f.token(&source).amount, 89);
    assert_eq!(f.token(&destination).amount, 11);
    assert!(membership(&f.account(&f.record(&alice)).data).unwrap().blacklisted);
}

/// A wallet Permanent Delegate composing native thaw, transfer and refreeze; `pd_recover` itself is
/// covered in `permanent_delegate.rs`.
#[test]
fn failed_pd_transfer_or_refreeze_rolls_back_the_whole_transaction() {
    let f = Fixture::new(Mode::Hook);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    f.mint_to(source, 100);
    f.block(alice, true);
    f.ok(&[f.native_freeze(source, true)]);
    let before_source = f.account(&source);
    let before_destination = f.account(&destination);
    f.fails(
        &[
            f.native_freeze(source, false),
            f.transfer(source, destination, f.admin, 101),
            f.native_freeze(source, true),
        ],
        1,
        TokenError::InsufficientFunds as u32,
    );
    assert_eq!(f.account(&source), before_source);
    assert_eq!(f.account(&destination), before_destination);

    let wrong_refreeze =
        token::freeze_account(&token2022::ID, &source, &f.mint, &f.keeper, &[]).unwrap();
    f.fails(
        &[
            f.native_freeze(source, false),
            f.transfer(source, destination, f.admin, 10),
            wrong_refreeze,
        ],
        2,
        TokenError::OwnerMismatch as u32,
    );
    assert_eq!(f.account(&source), before_source);
    assert_eq!(f.account(&destination), before_destination);
}

/// Token-2022 flags both accounts `transferring` only around its hook call, so calling the hook's
/// `Execute` directly with the accounts of a valid transfer fails, while the transfer itself works.
#[test]
fn the_hook_refuses_a_direct_execute_outside_a_transfer() {
    let f = Fixture::new(Mode::Hook);
    let source = f.create_token(Pubkey::new_unique());
    let destination = f.create_token(Pubkey::new_unique());
    f.mint_to(source, 10);
    let owner = f.token(&source).owner;
    let transfer = f.transfer(source, destination, owner, 4);

    // Transfer accounts: source, mint, destination, authority, the hook's extras, then the hook
    // program and its manifest. `Execute` takes the manifest before the extras.
    let extras = &transfer.accounts[4..transfer.accounts.len() - 2];
    let manifest = transfer.accounts[transfer.accounts.len() - 1].pubkey;
    let execute = spl_transfer_hook_interface::instruction::execute_with_extra_account_metas(
        &pubkey_policy_hook::ID,
        &source,
        &f.mint,
        &destination,
        &owner,
        &manifest,
        extras,
        4,
    );

    f.fails(&[execute], 0, pubkey_policy_hook::errors::HookError::NotTransferring);
    f.ok(&[transfer]);
    assert_eq!(f.token(&destination).amount, 4);
}
