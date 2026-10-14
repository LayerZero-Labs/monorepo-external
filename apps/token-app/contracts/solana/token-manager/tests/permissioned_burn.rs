//! Real manager + Token-2022 11 CPIs, including native source multisig and rollback.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::{error::ErrorCode, InstructionData, ToAccountMetas};
use mollusk_svm_result::types::TransactionProgramResult;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{
    error::TokenError,
    extension::{
        permissioned_burn::PermissionedBurnConfig, BaseStateWithExtensions, StateWithExtensions,
    },
    instruction as token,
    state::{Mint, Multisig},
};
use support::*;
use token_manager::{errors::TokenManagerError, RoleType};
use token_manager_interface::SignerKind;

fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: token_manager::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn fixture() -> Fixture {
    let f = Fixture::new(Mode::PermissionedBurn);
    f.ok(&[
        f.grant_role_ix(RoleType::Burner, f.operator),
        token::set_authority(
            &spl_token_2022_interface::ID,
            &f.mint,
            Some(&approver(&f)),
            token::AuthorityType::PermissionedBurn,
            &f.admin,
            &[],
        )
        .unwrap(),
    ]);
    f
}

fn approver(f: &Fixture) -> Pubkey {
    f.pb_signer()
}

fn burn(
    f: &Fixture,
    source: Pubkey,
    source_authority: Pubkey,
    members: &[Pubkey],
    amount: u64,
) -> Instruction {
    let mut instruction = ix(
        token_manager::accounts::PermissionedBurn {
            authority: f.operator,
            token_manager: f.token_manager,
            pb_signer: f.pb_signer(),
            mint: f.mint,
            token_account: source,
            source_authority,
            token_program: spl_token_2022_interface::ID,
            role_member: role_member(&f.token_manager, RoleType::Burner, &f.operator),
        },
        token_manager::instruction::PermissionedBurn { amount },
    );
    if members.is_empty() {
        instruction
            .accounts
            .iter_mut()
            .find(|a| a.pubkey == source_authority)
            .unwrap()
            .is_signer = true;
    } else {
        instruction
            .accounts
            .extend(members.iter().map(|key| AccountMeta::new_readonly(*key, true)));
    }
    instruction
}

fn ordinary(f: &Fixture, source: Pubkey, owner: Pubkey, amount: u64) -> Instruction {
    token::burn_checked(
        &spl_token_2022_interface::ID,
        &source,
        &f.mint,
        &owner,
        &[],
        amount,
        DECIMALS,
    )
    .unwrap()
}

fn mint_approver(f: &Fixture) -> Option<Pubkey> {
    let account = f.account(&f.mint);
    let mint = StateWithExtensions::<Mint>::unpack(&account.data).unwrap();
    mint.get_extension::<PermissionedBurnConfig>().unwrap().authority.into()
}

#[test]
fn owner_burn_requires_approval_and_changes_both_balance_and_supply() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 100);
    f.fails(&[ordinary(&f, source, f.keeper, 7)], 0, TokenError::InvalidInstruction as u32);
    f.ok(&[burn(&f, source, f.keeper, &[], 7)]);
    assert_eq!(f.token(&source).amount, 93);
    assert_eq!(
        StateWithExtensions::<Mint>::unpack(&f.account(&f.mint).data)
            .unwrap()
            .base
            .supply,
        93
    );
}

#[test]
fn approval_role_is_not_token_spending_authority_and_role_cannot_be_substituted() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 10);
    f.fails(&[burn(&f, source, f.operator, &[], 1)], 0, TokenError::OwnerMismatch as u32);
    let mut unauthorized = burn(&f, source, f.keeper, &[], 1);
    unauthorized.accounts[0].pubkey = f.keeper;
    // Leave the operator's valid role account: its PDA must not authorize another caller.
    f.fails(&[unauthorized], 0, ErrorCode::ConstraintSeeds);
    assert_eq!(f.token(&source).amount, 10);
}

#[test]
fn native_delegate_allowance_and_permanent_delegate_are_preserved() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 20);
    f.ok(&[token::approve_checked(
        &spl_token_2022_interface::ID,
        &source,
        &f.mint,
        &f.operator,
        &f.keeper,
        &[],
        5,
        DECIMALS,
    )
    .unwrap()]);
    f.ok(&[burn(&f, source, f.operator, &[], 4)]);
    f.fails(&[burn(&f, source, f.operator, &[], 2)], 0, TokenError::InsufficientFunds as u32);
    // PD still needs PB approval; it does not require the owner's signature.
    f.fails(&[ordinary(&f, source, f.admin, 2)], 0, TokenError::InvalidInstruction as u32);
    f.ok(&[burn(&f, source, f.admin, &[], 2)]);
    assert_eq!(f.token(&source).amount, 14);
}

#[test]
fn native_multisig_source_requires_its_threshold_even_with_valid_approval() {
    let f = fixture();
    let multisig = Pubkey::new_unique();
    f.ok(&[
        solana_system_interface::instruction::create_account(
            &f.admin,
            &multisig,
            f.context.mollusk.sysvars.rent.minimum_balance(Multisig::LEN),
            Multisig::LEN as u64,
            &spl_token_2022_interface::ID,
        ),
        token::initialize_multisig2(
            &spl_token_2022_interface::ID,
            &multisig,
            &[&f.keeper, &f.admin],
            2,
        )
        .unwrap(),
    ]);
    let source = f.create_token(multisig);
    f.mint_to(source, 10);
    assert_eq!(
        f.run(&[burn(&f, source, multisig, &[f.keeper], 1)]).program_result,
        TransactionProgramResult::Failure(0, ProgramError::MissingRequiredSignature)
    );
    f.ok(&[burn(&f, source, multisig, &[f.keeper, f.admin], 3)]);
    assert_eq!(f.token(&source).amount, 7);
}

#[test]
fn native_frozen_source_cannot_be_burned_even_with_pd_and_approval() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 10);
    f.ok(&[token::freeze_account(&spl_token_2022_interface::ID, &source, &f.mint, &f.admin, &[])
        .unwrap()]);
    f.fails(&[burn(&f, source, f.admin, &[], 1)], 0, TokenError::AccountFrozen as u32);
    // Native transaction composition remains sufficient for recovery.
    f.ok(&[
        token::thaw_account(&spl_token_2022_interface::ID, &source, &f.mint, &f.admin, &[])
            .unwrap(),
        burn(&f, source, f.admin, &[], 1),
        token::freeze_account(&spl_token_2022_interface::ID, &source, &f.mint, &f.admin, &[])
            .unwrap(),
    ]);
    assert_eq!(f.token(&source).amount, 9);
    assert!(f.token(&source).is_frozen());
}

#[test]
fn burn_rejects_a_substituted_state_or_signer() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 10);
    // Another mint's real root.
    let other = fixture();
    f.context
        .account_store
        .borrow_mut()
        .insert(other.token_manager, other.account(&other.token_manager));
    let mut wrong_state = burn(&f, source, f.keeper, &[], 1);
    wrong_state.accounts[1].pubkey = other.token_manager;
    f.fails(&[wrong_state], 0, ErrorCode::ConstraintHasOne);
    // A signer PDA of another kind is not this root's PB signer.
    let mut wrong_signer = burn(&f, source, f.keeper, &[], 1);
    wrong_signer.accounts[2].pubkey = f.acl_signer();
    f.fails(&[wrong_signer], 0, ErrorCode::ConstraintSeeds);
    assert_eq!(f.token(&source).amount, 10);
    assert_eq!(mint_approver(&f), Some(approver(&f)));
}

#[test]
fn admin_rotation_keeps_native_approver_and_delegates_burns_only_through_roles() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 10);
    let mint_before = f.account(&f.mint);
    f.rotate_default_admin(f.keeper);
    assert_eq!(f.account(&f.mint), mint_before);
    assert_eq!(mint_approver(&f), Some(approver(&f)));
    // The previous admin can no longer move the approver.
    f.fails(
        &[f.set_native_authority_ix(SignerKind::PermissionedBurn, f.admin)],
        0,
        anchor_lang::error::ErrorCode::AccountNotInitialized,
    );
    f.fails(&[f.grant_role_ix(RoleType::Burner, f.keeper)], 0, ErrorCode::AccountNotInitialized);
    // DefaultAdmin is not implicitly a Burner, even when it owns the source.
    let mut keeper_burn = burn(&f, source, f.keeper, &[], 1);
    for meta in &mut keeper_burn.accounts {
        if meta.pubkey == f.operator {
            meta.pubkey = f.keeper;
        }
        if meta.pubkey == role_member(&f.token_manager, RoleType::Burner, &f.operator) {
            meta.pubkey = role_member(&f.token_manager, RoleType::Burner, &f.keeper);
        }
    }
    f.fails(&[keeper_burn.clone()], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.as_current_admin(f.grant_role_ix(RoleType::Burner, f.keeper)), keeper_burn]);
    // Existing operational grants survive rotation until explicitly revoked.
    f.ok(&[burn(&f, source, f.keeper, &[], 1)]);
    f.ok(&[f.revoke_role_ix(RoleType::Burner, f.operator)]);
    f.fails(&[burn(&f, source, f.keeper, &[], 1)], 0, ErrorCode::AccountNotInitialized);
    f.rotate_default_admin(f.admin);
    assert_eq!(mint_approver(&f), Some(approver(&f)));
    f.fails(&[burn(&f, source, f.keeper, &[], 1)], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.grant_role_ix(RoleType::Burner, f.operator), burn(&f, source, f.keeper, &[], 1)]);
    assert_eq!(f.token(&source).amount, 7);
}

#[test]
fn renunciation_restores_ordinary_burn_and_cannot_be_reversed() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 10);
    f.ok(&f.renounce_pb_ixs());
    assert_eq!(mint_approver(&f), None);
    f.ok(&[ordinary(&f, source, f.keeper, 1)]);
    f.fails(&[burn(&f, source, f.keeper, &[], 1)], 0, TokenError::InvalidInstruction as u32);
    f.fails(
        &[token::set_authority(
            &spl_token_2022_interface::ID,
            &f.mint,
            Some(&approver(&f)),
            token::AuthorityType::PermissionedBurn,
            &f.admin,
            &[],
        )
        .unwrap()],
        0,
        TokenError::AuthorityTypeNotSupported as u32,
    );
}

#[test]
fn only_current_admin_can_renounce_and_later_failure_rolls_back() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 10);
    f.rotate_default_admin(f.keeper);
    f.fails(&f.renounce_pb_ixs(), 0, anchor_lang::error::ErrorCode::AccountNotInitialized);
    // The current admin (keeper) takes the approver and nulls it.
    let renounce = vec![
        f.as_current_admin(f.set_native_authority_ix(SignerKind::PermissionedBurn, f.keeper)),
        token::set_authority(
            &spl_token_2022_interface::ID,
            &f.mint,
            None,
            token::AuthorityType::PermissionedBurn,
            &f.keeper,
            &[],
        )
        .unwrap(),
    ];
    let mint_before = f.account(&f.mint);
    let store_before = f.account(&f.token_manager);
    let mut failing = renounce.clone();
    failing.push(burn(&f, source, f.keeper, &[], 1));
    f.fails(&failing, 2, TokenError::InvalidInstruction as u32);
    assert_eq!(f.account(&f.mint), mint_before);
    assert_eq!(f.account(&f.token_manager), store_before);
    let mut instructions = renounce;
    instructions.push(ordinary(&f, source, f.keeper, 1));
    f.ok(&instructions);
    assert_eq!(mint_approver(&f), None);
    assert_eq!(f.account(&f.token_manager), store_before);
}

#[test]
fn shared_pb_and_pd_signer_does_not_turn_approval_into_confiscation() {
    let f = fixture();
    let source = f.create_token(f.keeper);
    f.mint_to(source, 10);
    f.ok(&[token::set_authority(
        &spl_token_2022_interface::ID,
        &f.mint,
        Some(&f.pb_signer()),
        token::AuthorityType::PermanentDelegate,
        &f.admin,
        &[],
    )
    .unwrap()]);
    // Pass an unrelated signer as a fake "multisig member". The PB signature
    // must not satisfy this single-key PD authority through duplicate accounts.
    let forged = burn(&f, source, f.pb_signer(), &[f.operator], 1);
    f.fails(&[forged], 0, TokenManagerError::MissingBurnSourceSignature);
    assert_eq!(f.token(&source).amount, 10);
    f.ok(&[burn(&f, source, f.keeper, &[], 1)]);
}

#[test]
fn shared_signer_cannot_supply_a_source_multisig_vote_via_pb_approval() {
    let f = fixture();
    let multisig = Pubkey::new_unique();
    f.ok(&[
        solana_system_interface::instruction::create_account(
            &f.admin,
            &multisig,
            f.context.mollusk.sysvars.rent.minimum_balance(Multisig::LEN),
            Multisig::LEN as u64,
            &spl_token_2022_interface::ID,
        ),
        token::initialize_multisig2(
            &spl_token_2022_interface::ID,
            &multisig,
            &[&f.pb_signer(), &f.keeper],
            1,
        )
        .unwrap(),
    ]);
    let source = f.create_token(multisig);
    f.mint_to(source, 10);
    let mut forged = burn(&f, source, multisig, &[f.pb_signer()], 1);
    // It is not a transaction signer; invoke_signed would make it one at the
    // inner Token-2022 call if the manager failed to check existing privileges.
    for meta in &mut forged.accounts {
        if meta.pubkey == f.pb_signer() {
            meta.is_signer = false;
        }
    }
    f.fails(&[forged], 0, TokenManagerError::MissingBurnSourceSignature);
    f.ok(&[burn(&f, source, multisig, &[f.keeper], 1)]);
}
