//! Pauser and Unpauser: pause and resume signed by the root's Pause signer, which holds the pause
//! authority directly or as one member of a 1-of-n native multisig.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::{error::ErrorCode, InstructionData, ToAccountMetas};
use mollusk_svm_result::types::TransactionProgramResult;
use solana_instruction::Instruction;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{
    error::TokenError, extension::pausable::instruction as pausable, instruction as token,
};
use support::*;
use token_manager::{errors::TokenManagerError, RoleType};

fn set_native(f: &Fixture, kind: token::AuthorityType, next: &Pubkey) -> Instruction {
    token::set_authority(&spl_token_2022_interface::ID, &f.mint, Some(next), kind, &f.admin, &[])
        .unwrap()
}

/// `caller`, holding `role`, pauses (`true`) or unpauses through this root.
fn set_paused(
    f: &Fixture,
    caller: Pubkey,
    role: RoleType,
    paused: bool,
    multisig: Option<Pubkey>,
) -> Instruction {
    let (accounts, data) = if paused {
        (
            token_manager::accounts::Pause {
                authority: caller,
                token_manager: f.token_manager,
                pause_signer: f.pause_signer(),
                pause_multisig: multisig,
                mint: f.mint,
                token_program: spl_token_2022_interface::ID,
                role_member: role_member(&f.token_manager, role, &caller),
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            token_manager::instruction::Pause {}.data(),
        )
    } else {
        (
            token_manager::accounts::Unpause {
                authority: caller,
                token_manager: f.token_manager,
                pause_signer: f.pause_signer(),
                pause_multisig: multisig,
                mint: f.mint,
                token_program: spl_token_2022_interface::ID,
                role_member: role_member(&f.token_manager, role, &caller),
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            token_manager::instruction::Unpause {}.data(),
        )
    };
    Instruction { program_id: token_manager::ID, accounts, data }
}

/// Pausable mint whose pause authority is this root's Pause signer; `operator` is the Pauser and
/// `keeper` the Unpauser.
fn pause_fixture() -> Fixture {
    let f = Fixture::new(Mode::AclHookPausable);
    f.ok(&[
        f.grant_role_ix(RoleType::Pauser, f.operator),
        f.grant_role_ix(RoleType::Unpauser, f.keeper),
    ]);
    f
}

#[test]
fn pauser_pauses_and_unpauser_resumes() {
    let f = pause_fixture();
    f.ok(&[set_native(&f, token::AuthorityType::Pause, &f.pause_signer())]);
    f.ok(&[set_paused(&f, f.operator, RoleType::Pauser, true, None)]);
    assert!(f.paused());
    f.ok(&[set_paused(&f, f.keeper, RoleType::Unpauser, false, None)]);
    assert!(!f.paused());
}

/// Pausing and resuming are separate roles, as on EVM.
#[test]
fn pauser_cannot_resume_and_unpauser_cannot_pause() {
    let f = pause_fixture();
    f.ok(&[set_native(&f, token::AuthorityType::Pause, &f.pause_signer())]);
    f.fails(
        &[set_paused(&f, f.keeper, RoleType::Pauser, true, None)],
        0,
        ErrorCode::AccountNotInitialized,
    );
    f.ok(&[set_paused(&f, f.operator, RoleType::Pauser, true, None)]);
    f.fails(
        &[set_paused(&f, f.operator, RoleType::Unpauser, false, None)],
        0,
        ErrorCode::AccountNotInitialized,
    );
    assert!(f.paused());
}

#[test]
fn pause_fails_unless_this_root_holds_the_pause_authority() {
    let f = pause_fixture();
    // `admin` still holds the pause authority.
    f.fails(
        &[set_paused(&f, f.operator, RoleType::Pauser, true, None)],
        0,
        TokenError::OwnerMismatch as u32,
    );
    assert!(!f.paused());
}

/// Through a 1-of-n pause multisig, the root pauses and another member still resumes directly.
#[test]
fn pause_through_a_1_of_n_multisig_leaves_other_members_in_control() {
    let f = pause_fixture();
    let multisig = f.native_multisig(&[&f.admin, &f.pause_signer()], 1);
    f.ok(&[set_native(&f, token::AuthorityType::Pause, &multisig)]);
    f.ok(&[set_paused(&f, f.operator, RoleType::Pauser, true, Some(multisig))]);
    assert!(f.paused());
    f.ok(&[
        pausable::resume(&spl_token_2022_interface::ID, &f.mint, &multisig, &[&f.admin]).unwrap()
    ]);
    assert!(!f.paused());
}

/// The Pause signer is one vote: a multisig needing two cannot be met by the root alone.
#[test]
fn pause_cannot_meet_a_multisig_threshold_above_one() {
    let f = pause_fixture();
    let multisig = f.native_multisig(&[&f.admin, &f.pause_signer()], 2);
    f.ok(&[set_native(&f, token::AuthorityType::Pause, &multisig)]);
    assert_eq!(
        f.run(&[set_paused(&f, f.operator, RoleType::Pauser, true, Some(multisig))])
            .program_result,
        TransactionProgramResult::Failure(0, ProgramError::MissingRequiredSignature)
    );
    assert!(!f.paused());
}

/// As on EVM, pausing a paused mint or resuming a running one fails instead of emitting a no-op.
#[test]
fn repeating_a_pause_or_unpause_fails() {
    let f = pause_fixture();
    f.ok(&[set_native(&f, token::AuthorityType::Pause, &f.pause_signer())]);
    f.fails(
        &[set_paused(&f, f.keeper, RoleType::Unpauser, false, None)],
        0,
        TokenManagerError::PauseStateIdempotent,
    );
    f.ok(&[set_paused(&f, f.operator, RoleType::Pauser, true, None)]);
    f.fails(
        &[set_paused(&f, f.operator, RoleType::Pauser, true, None)],
        0,
        TokenManagerError::PauseStateIdempotent,
    );
    assert!(f.paused());
}
