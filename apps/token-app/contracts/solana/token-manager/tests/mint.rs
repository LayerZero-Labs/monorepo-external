//! Minter: `mint_to` signed by the root's Mint signer, which holds the mint authority directly or
//! as one member of a 1-of-n native multisig.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::{error::ErrorCode, InstructionData, ToAccountMetas};
use mollusk_svm_result::types::TransactionProgramResult;
use solana_instruction::Instruction;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{error::TokenError, instruction as token};
use support::*;
use token_manager::RoleType;
use token_manager_interface::{signer_address, SignerKind};

fn mint_signer(f: &Fixture) -> Pubkey {
    signer_address(&f.token_manager, SignerKind::Mint).0
}

fn set_mint_authority(f: &Fixture, next: &Pubkey) -> Instruction {
    token::set_authority(
        &spl_token_2022_interface::ID,
        &f.mint,
        Some(next),
        token::AuthorityType::MintTokens,
        &f.admin,
        &[],
    )
    .unwrap()
}

fn mint_to(
    f: &Fixture,
    caller: Pubkey,
    destination: Pubkey,
    amount: u64,
    multisig: Option<Pubkey>,
) -> Instruction {
    Instruction {
        program_id: token_manager::ID,
        accounts: token_manager::accounts::MintTo {
            authority: caller,
            token_manager: f.token_manager,
            mint_signer: mint_signer(f),
            mint_multisig: multisig,
            mint: f.mint,
            token_account: destination,
            token_program: spl_token_2022_interface::ID,
            role_member: role_member(&f.token_manager, RoleType::Minter, &caller),
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None),
        data: token_manager::instruction::MintTo { amount }.data(),
    }
}

/// ACL mint whose mint authority starts as `admin`; `operator` is the Minter.
fn mint_fixture() -> Fixture {
    let f = Fixture::new(Mode::Acl);
    f.ok(&[f.grant_role_ix(RoleType::Minter, f.operator)]);
    f
}

fn thawed_account(f: &Fixture) -> Pubkey {
    let account = f.create_token(Pubkey::new_unique());
    f.ok(&[f.admin_freeze(account, false, f.admin)]);
    account
}

#[test]
fn minter_mints_through_the_mint_signer() {
    let f = mint_fixture();
    f.ok(&[set_mint_authority(&f, &mint_signer(&f))]);
    let account = thawed_account(&f);
    f.ok(&[mint_to(&f, f.operator, account, 7, None)]);
    assert_eq!(f.token(&account).amount, 7);
}

#[test]
fn mint_requires_the_minter_role() {
    let f = mint_fixture();
    f.ok(&[set_mint_authority(&f, &mint_signer(&f))]);
    let account = thawed_account(&f);
    f.fails(&[mint_to(&f, f.keeper, account, 7, None)], 0, ErrorCode::AccountNotInitialized);
    assert_eq!(f.token(&account).amount, 0);
}

/// Token-2022 rejects minting to a frozen account, so the freeze state gates mints as it gates
/// every other credit.
#[test]
fn mint_to_a_frozen_account_fails() {
    let f = mint_fixture();
    f.ok(&[set_mint_authority(&f, &mint_signer(&f))]);
    let frozen = f.create_token(Pubkey::new_unique());
    f.fails(&[mint_to(&f, f.operator, frozen, 7, None)], 0, TokenError::AccountFrozen as u32);
}

#[test]
fn mint_fails_unless_this_root_holds_the_mint_authority() {
    let f = mint_fixture();
    let account = thawed_account(&f);
    f.fails(&[mint_to(&f, f.operator, account, 7, None)], 0, TokenError::OwnerMismatch as u32);
}

/// A 1-of-n mint multisig lets the root mint alongside another member, such as a Console OFT's
/// `oft_store`, which keeps minting directly.
#[test]
fn mint_through_a_1_of_n_multisig_shared_with_another_minter() {
    let f = mint_fixture();
    let multisig = f.native_multisig(&[&f.admin, &mint_signer(&f)], 1);
    f.ok(&[set_mint_authority(&f, &multisig)]);
    let account = thawed_account(&f);
    f.ok(&[mint_to(&f, f.operator, account, 5, Some(multisig))]);
    f.ok(&[token::mint_to(
        &spl_token_2022_interface::ID,
        &f.mint,
        &account,
        &multisig,
        &[&f.admin],
        2,
    )
    .unwrap()]);
    assert_eq!(f.token(&account).amount, 7);
}

/// The Mint signer is one vote: a multisig needing two cannot be met by the root alone.
#[test]
fn mint_cannot_meet_a_multisig_threshold_above_one() {
    let f = mint_fixture();
    let multisig = f.native_multisig(&[&f.admin, &mint_signer(&f)], 2);
    f.ok(&[set_mint_authority(&f, &multisig)]);
    let account = thawed_account(&f);
    assert_eq!(
        f.run(&[mint_to(&f, f.operator, account, 5, Some(multisig))]).program_result,
        TransactionProgramResult::Failure(0, ProgramError::MissingRequiredSignature)
    );
    assert_eq!(f.token(&account).amount, 0);
}
