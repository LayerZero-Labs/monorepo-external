//! PD capability: `pd_burn` (EVM `burn(from)`) and `pd_recover` (EVM `recoverFunds`).
#[path = "support/mod.rs"]
mod support;

use anchor_lang::{InstructionData, ToAccountMetas};
use mollusk_svm_result::types::TransactionProgramResult;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{
    error::TokenError, extension::pausable::instruction as pausable, instruction as token,
    state::AccountState,
};
use support::*;
use token_manager::RoleType;
use token_manager_interface::{signer_address, SignerKind};

fn pd_signer(f: &Fixture) -> Pubkey {
    signer_address(&f.token_manager, SignerKind::PermanentDelegate).0
}

fn set_native(f: &Fixture, kind: token::AuthorityType, next: Option<&Pubkey>) -> Instruction {
    token::set_authority(&spl_token_2022_interface::ID, &f.mint, next, kind, &f.admin, &[]).unwrap()
}

/// Replace `operator` (and its role accounts) by `caller` in an instruction.
fn as_caller(f: &Fixture, mut ix: Instruction, caller: Pubkey) -> Instruction {
    for meta in &mut ix.accounts {
        for role in [RoleType::PdBurner] {
            if meta.pubkey == role_member(&f.token_manager, role, &f.operator) {
                meta.pubkey = role_member(&f.token_manager, role, &caller);
            }
        }
        if meta.pubkey == f.operator {
            meta.pubkey = caller;
        }
    }
    ix
}

/// Replace `admin` (and its DefaultAdmin record) by `caller` in an instruction.
fn as_admin_caller(f: &Fixture, mut ix: Instruction, caller: Pubkey) -> Instruction {
    for meta in &mut ix.accounts {
        if meta.pubkey == role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin) {
            meta.pubkey = role_member(&f.token_manager, RoleType::DefaultAdmin, &caller);
        }
        if meta.pubkey == f.admin {
            meta.pubkey = caller;
        }
    }
    ix
}

fn pd_burn(f: &Fixture, source: Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: token_manager::ID,
        accounts: token_manager::accounts::PdBurn {
            authority: f.operator,
            token_manager: f.token_manager,
            pd_signer: pd_signer(f),
            pb_signer: f.pb_signer(),
            mint: f.mint,
            token_account: source,
            token_program: spl_token_2022_interface::ID,
            role_member: role_member(&f.token_manager, RoleType::PdBurner, &f.operator),
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None),
        data: token_manager::instruction::PdBurn { amount }.data(),
    }
}

/// PB routes through this root's PB signer and PD is this root's PD signer.
fn burn_fixture() -> Fixture {
    let f = Fixture::new(Mode::PermissionedBurn);
    f.ok(&[
        f.grant_role_ix(RoleType::PdBurner, f.operator),
        set_native(&f, token::AuthorityType::PermissionedBurn, Some(&f.pb_signer())),
        set_native(&f, token::AuthorityType::PermanentDelegate, Some(&pd_signer(&f))),
    ]);
    f
}

/// PdBurner alone authorizes a PD burn while PB routes through this root; the root's PB signer
/// co-signs as the approval, and the caller needs no Burner grant.
#[test]
fn pd_burn_with_live_pb_needs_only_pd_burner_and_both_signers() {
    let f = burn_fixture();
    let owner = Pubkey::new_unique();
    let source = f.create_token(owner);
    f.mint_to(source, 10);
    f.ok(&[pd_burn(&f, source, 3)]);
    assert_eq!(f.token(&source).amount, 7);
}

#[test]
fn pd_burn_without_pb_needs_only_pd_burner() {
    let f = burn_fixture();
    let owner = Pubkey::new_unique();
    let source = f.create_token(owner);
    f.mint_to(source, 10);
    // Renouncing PB is irreversible; standard burns signed by the PD alone work afterwards.
    let mut instructions = f.renounce_pb_ixs();
    instructions.push(pd_burn(&f, source, 4));
    f.ok(&instructions);
    assert_eq!(f.token(&source).amount, 6);
}

#[test]
fn pd_burn_ignores_policy_and_rejects_a_foreign_pb_authority_frozen_source_and_non_burners() {
    let f = burn_fixture();
    let owner = Pubkey::new_unique();
    let source = f.create_token(owner);
    f.mint_to(source, 10);

    // Only the token account matters: a policy-blocked owner is still burnable.
    f.block(owner, true);
    f.ok(&[pd_burn(&f, source, 1)]);
    f.block(owner, false);

    f.ok(&[f.native_freeze(source, true)]);
    f.fails(&[pd_burn(&f, source, 1)], 0, TokenError::AccountFrozen as u32);
    f.ok(&[f.native_freeze(source, false)]);

    f.fails(
        &[as_caller(&f, pd_burn(&f, source, 1), f.keeper)],
        0,
        anchor_lang::error::ErrorCode::AccountNotInitialized,
    );

    // PB held by anyone but this root's PB signer blocks pd_burn until handed over.
    let move_pb = Instruction {
        program_id: token_manager::ID,
        accounts: token_manager::accounts::SetNativeAuthority {
            authority: f.admin,
            token_manager: f.token_manager,
            signer: f.pb_signer(),
            multisig: None,
            mint: f.mint,
            mint_config: None,
            acl_program: None,
            token_program: spl_token_2022_interface::ID,
            role_member: role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin),
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None),
        data: token_manager::instruction::SetNativeAuthority {
            kind: SignerKind::PermissionedBurn,
            new_authority: f.keeper,
        }
        .data(),
    };
    f.ok(&[move_pb]);
    // Token-2022 rejects our PB signer as the approver once another key holds PB.
    assert_eq!(
        f.run(&[pd_burn(&f, source, 1)]).program_result,
        TransactionProgramResult::Failure(0, ProgramError::InvalidAccountData)
    );
    assert_eq!(f.token(&source).amount, 9);
}

/// ACL + hook + PD mint whose PD is this root's PD signer; `admin` is its DefaultAdmin.
fn recover_fixture() -> Fixture {
    let f = Fixture::new(Mode::AclHook);
    f.ok(&[set_native(&f, token::AuthorityType::PermanentDelegate, Some(&pd_signer(&f)))]);
    f
}

/// Funded account for `owner`, thawed for minting and then refrozen by the Freezer.
fn funded_frozen(f: &Fixture, owner: Pubkey, amount: u64) -> Pubkey {
    let account = f.create_token(owner);
    f.ok(&[f.admin_freeze(account, false, f.admin)]);
    f.mint_to(account, amount);
    f.ok(&[f.admin_freeze(account, true, f.admin)]);
    account
}

/// Thawed, empty destination for an allowed owner.
fn open_destination(f: &Fixture, owner: Pubkey) -> Pubkey {
    let account = f.create_token(owner);
    f.ok(&[f.admin_freeze(account, false, f.admin)]);
    account
}

fn pd_recover(f: &Fixture, source: Pubkey, destination: Pubkey, amount: u64) -> Instruction {
    pd_recover_with(f, source, destination, amount, None)
}

fn pd_recover_with(
    f: &Fixture,
    source: Pubkey,
    destination: Pubkey,
    amount: u64,
    pause_multisig: Option<Pubkey>,
) -> Instruction {
    let mut accounts = token_manager::accounts::PdRecover {
        authority: f.admin,
        token_manager: f.token_manager,
        pd_signer: pd_signer(f),
        acl_signer: f.acl_signer(),
        pause_signer: f.pause_signer(),
        pause_multisig,
        mint: f.mint,
        source,
        destination,
        mint_config: f.mint_config(),
        acl_program: token_acl_interface::TOKEN_ACL_ID,
        token_program: spl_token_2022_interface::ID,
        role_member: role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin),
        event_authority: event_authority(&token_manager::ID),
        program: token_manager::ID,
    }
    .to_account_metas(None);
    // The hook's resolved extras, exactly as an off-chain transfer would carry them.
    let transfer = f.transfer(source, destination, pd_signer(f), amount);
    accounts.extend(
        transfer.accounts[4..]
            .iter()
            .map(|meta| AccountMeta { is_signer: false, ..meta.clone() }),
    );
    Instruction {
        program_id: token_manager::ID,
        accounts,
        data: token_manager::instruction::PdRecover { amount }.data(),
    }
}

#[test]
fn pd_recover_moves_frozen_funds_and_refreezes_the_source() {
    let f = recover_fixture();
    let source = funded_frozen(&f, Pubkey::new_unique(), 10);
    let destination = open_destination(&f, Pubkey::new_unique());
    f.ok(&[pd_recover(&f, source, destination, 6)]);
    assert_eq!(f.token(&source).amount, 4);
    assert_eq!(f.token(&destination).amount, 6);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
}

/// `recover_fixture` on a Pausable mint, with `admin` still holding the pause authority.
fn pausable_recover_fixture() -> Fixture {
    let f = Fixture::new(Mode::AclHookPausable);
    f.ok(&[set_native(&f, token::AuthorityType::PermanentDelegate, Some(&pd_signer(&f)))]);
    f
}

#[test]
fn pd_recover_resumes_and_re_pauses_a_paused_mint_whose_pause_it_holds() {
    let f = pausable_recover_fixture();
    let source = funded_frozen(&f, Pubkey::new_unique(), 10);
    let destination = open_destination(&f, Pubkey::new_unique());
    f.ok(&[
        f.pause_ix(f.admin, true),
        set_native(&f, token::AuthorityType::Pause, Some(&f.pause_signer())),
    ]);
    f.ok(&[pd_recover(&f, source, destination, 6)]);
    assert_eq!(f.token(&destination).amount, 6);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
    assert!(f.paused(), "recovery must leave the mint paused");
}

#[test]
fn a_paused_mint_is_recoverable_only_if_this_root_holds_its_pause() {
    let f = pausable_recover_fixture();
    let source = funded_frozen(&f, Pubkey::new_unique(), 10);
    let destination = open_destination(&f, Pubkey::new_unique());
    f.ok(&[f.pause_ix(f.admin, true)]);
    // Token-2022 rejects the resume: the Pause signer is not the pause authority.
    f.fails(&[pd_recover(&f, source, destination, 1)], 0, TokenError::OwnerMismatch as u32);
    assert_eq!(f.token(&source).amount, 10);
    assert!(f.paused());
}

#[test]
fn an_unpaused_pausable_mint_recovers_without_the_pause_authority() {
    let f = pausable_recover_fixture();
    let source = funded_frozen(&f, Pubkey::new_unique(), 10);
    let destination = open_destination(&f, Pubkey::new_unique());
    f.ok(&[pd_recover(&f, source, destination, 3)]);
    assert_eq!(f.token(&destination).amount, 3);
    assert!(!f.paused());
}

#[test]
fn the_pause_authority_can_be_handed_back_out() {
    let f = pausable_recover_fixture();
    f.ok(&[set_native(&f, token::AuthorityType::Pause, Some(&f.pause_signer()))]);
    f.ok(&[f.set_native_authority_ix(SignerKind::Pause, f.keeper)]);
    f.ok(&[f.pause_ix(f.keeper, true)]);
    assert!(f.paused());
}

/// A native `m`-of-n multisig over `members`, made the mint's pause authority.
fn pause_multisig(f: &Fixture, members: &[&Pubkey], m: u8) -> Pubkey {
    let multisig = f.native_multisig(members, m);
    f.ok(&[set_native(f, token::AuthorityType::Pause, Some(&multisig))]);
    multisig
}

/// `members` pause the mint through the pause multisig.
fn pause_as_members(f: &Fixture, multisig: &Pubkey, members: &[&Pubkey]) -> Instruction {
    pausable::pause(&spl_token_2022_interface::ID, &f.mint, multisig, members).unwrap()
}

#[test]
fn pd_recover_resumes_and_re_pauses_through_a_1_of_n_pause_multisig() {
    let f = pausable_recover_fixture();
    let source = funded_frozen(&f, Pubkey::new_unique(), 10);
    let destination = open_destination(&f, Pubkey::new_unique());
    let multisig = pause_multisig(&f, &[&f.keeper, &f.pause_signer()], 1);
    f.ok(&[pause_as_members(&f, &multisig, &[&f.keeper])]);
    f.ok(&[pd_recover_with(&f, source, destination, 6, Some(multisig))]);
    assert_eq!(f.token(&destination).amount, 6);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
    assert!(f.paused(), "recovery must leave the mint paused");
}

/// The Pause signer is one vote: a pause multisig needing two cannot be resumed by it alone.
#[test]
fn pd_recover_cannot_meet_a_pause_multisig_threshold_above_one() {
    let f = pausable_recover_fixture();
    let source = funded_frozen(&f, Pubkey::new_unique(), 10);
    let destination = open_destination(&f, Pubkey::new_unique());
    let multisig = pause_multisig(&f, &[&f.keeper, &f.admin, &f.pause_signer()], 2);
    f.ok(&[pause_as_members(&f, &multisig, &[&f.keeper, &f.admin])]);
    assert_eq!(
        f.run(&[pd_recover_with(&f, source, destination, 1, Some(multisig))])
            .program_result,
        TransactionProgramResult::Failure(0, ProgramError::MissingRequiredSignature)
    );
    assert_eq!(f.token(&source).amount, 10);
    assert!(f.paused());
}

/// Frozen stands in for EVM's blocked-source check; policy is never consulted, so neither the
/// source's nor the destination's membership matters (the hook exempts the permanent delegate).
#[test]
fn pd_recover_requires_only_a_frozen_source_and_a_usable_destination() {
    let f = recover_fixture();
    // Both owners blocked: EVM would require a blocked source, Solana only a frozen one.
    let (bad_source, bad) = (Pubkey::new_unique(), Pubkey::new_unique());
    let source = funded_frozen(&f, bad_source, 10);
    let destination = open_destination(&f, bad);
    f.block(bad_source, true);
    f.block(bad, true);

    f.ok(&[f.admin_freeze(source, false, f.admin)]);
    // Token-2022 refuses to thaw an account that is not frozen.
    f.fails(&[pd_recover(&f, source, destination, 1)], 0, TokenError::InvalidState as u32);
    f.ok(&[f.admin_freeze(source, true, f.admin)]);

    // A frozen destination fails in Token-2022.
    let frozen_destination = f.create_token(Pubkey::new_unique());
    f.fails(&[pd_recover(&f, source, frozen_destination, 1)], 0, TokenError::AccountFrozen as u32);

    // Only DefaultAdmin recovers: any other caller, whatever roles it holds, has no admin record.
    f.ok(&[f.grant_role_ix(RoleType::Freezer, f.keeper)]);
    f.fails(
        &[as_admin_caller(&f, pd_recover(&f, source, destination, 1), f.keeper)],
        0,
        anchor_lang::error::ErrorCode::AccountNotInitialized,
    );
    // Recovering into the source itself fails account validation, before any thaw.
    f.fails(
        &[pd_recover(&f, source, source, 1)],
        0,
        anchor_lang::error::ErrorCode::ConstraintDuplicateMutableAccount,
    );
    // No failed recovery leaves its thaw behind.
    assert_eq!(f.token(&source).amount, 10);
    assert_eq!(f.token(&source).state, AccountState::Frozen);

    f.ok(&[pd_recover(&f, source, destination, 1)]);
    assert_eq!(f.token(&destination).amount, 1);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
}
