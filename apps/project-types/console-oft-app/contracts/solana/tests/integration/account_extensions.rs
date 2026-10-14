//! Token-account extensions an owner can turn on, cross-checked on every account an OFT touches:
//! the recipient's ATA, the sender's source, the fee deposit and the redirect escrow. Each runs on
//! a plain Token-2022 mint and on the full issuer stack (Token ACL, hook, PermissionedBurn,
//! Permanent Delegate, Pausable), deployed through the real programs.
//!
//! - MemoTransfer only constrains incoming transfers: crediting such an account fails with
//!   `NoMemo`, since the program issues no memo. On a recipient or redirect escrow the receive
//!   reverts and the payload stays retryable; on the fee deposit every fee-bearing send fails.
//!   Turning it off unblocks it. A source with it sends normally.
//! - CpiGuard only constrains the owner's own actions in a CPI: `send` debits a guarded source in a
//!   CPI the owner signs, so it fails with `CpiGuardTransferBlocked` unless the owner lifts the
//!   guard around it at the top level; a guarded destination receives normally.
//!
//! Extensions the mint requires (TransferHookAccount, PausableAccount, TransferFeeAmount,
//! NonTransferableAccount) and ATAs' ImmutableOwner are covered by `configurations`.
//! ConfidentialTransferAccount needs zero-knowledge proofs to configure and is not covered.
use crate::{deploy::Deployment, harness::*};
use console_oft::state::RoleType as OftRole;
use spl_token_2022_interface::{
    error::TokenError,
    extension::{cpi_guard, memo_transfer, BaseStateWithExtensions},
};

fn mints() -> [Deployment; 2] {
    let plain = Deployment { policy: true, redirect: true, ..Deployment::default() };
    [
        plain,
        Deployment {
            acl: true,
            hook: true,
            pb: true,
            permanent_delegate: true,
            pausable: true,
            ..plain
        },
    ]
}

/// Reallocates `account` for `extension` and turns it on, or turns it back off.
fn set(
    h: &Harness,
    account: Pubkey,
    owner: Pubkey,
    extension: ExtensionType,
    on: bool,
) -> Instruction {
    let program = &h.token_program;
    match (extension, on) {
        (ExtensionType::MemoTransfer, true) => {
            memo_transfer::instruction::enable_required_transfer_memos(
                program,
                &account,
                &owner,
                &[],
            )
        },
        (ExtensionType::MemoTransfer, false) => {
            memo_transfer::instruction::disable_required_transfer_memos(
                program,
                &account,
                &owner,
                &[],
            )
        },
        (ExtensionType::CpiGuard, true) => {
            cpi_guard::instruction::enable_cpi_guard(program, &account, &owner, &[])
        },
        (ExtensionType::CpiGuard, false) => {
            cpi_guard::instruction::disable_cpi_guard(program, &account, &owner, &[])
        },
        (other, _) => panic!("not an owner-enabled extension: {other:?}"),
    }
    .unwrap()
}

fn enable(h: &Harness, account: Pubkey, owner: Pubkey, extension: ExtensionType) {
    h.ok(&[
        token::reallocate(&h.token_program, &account, &h.f.payer, &owner, &[], &[extension])
            .unwrap(),
        set(h, account, owner, extension, true),
    ]);
}

fn token_error(error: TokenError) -> TransactionProgramResult {
    TransactionProgramResult::Failure(0, ProgramError::Custom(error as u32))
}

/// Receives the suite's message and returns its result; a failure must leave the payload.
fn receive(h: &Harness) -> TransactionProgramResult {
    h.verify();
    let payload = h.account(h.payload());
    let result = h.run(&h.instructions()).program_result;
    if !result.is_ok() {
        assert_eq!(h.account(h.payload()), payload, "payload must stay retryable");
    }
    result
}

/// The recipient's ATA, created and (on ACL mints) thawed before the message arrives.
fn open_recipient(h: &Harness, d: &Deployment) {
    h.ok(&[h.create_ata()]);
    if d.acl {
        h.ok(&[h.thaw()]);
    }
}

#[test]
fn a_memo_required_recipient_holds_its_receive_until_it_turns_memos_off() {
    for d in mints() {
        let h = Harness::deploy(d);
        open_recipient(&h, &d);
        enable(&h, h.ata(), h.recipient(), ExtensionType::MemoTransfer);
        assert_eq!(receive(&h), token_error(TokenError::NoMemo), "{d:?}");
        h.ok(&[set(&h, h.ata(), h.recipient(), ExtensionType::MemoTransfer, false)]);
        assert!(receive(&h).is_ok(), "{d:?}");
        assert_eq!(h.token(h.ata()).amount, 1_000);
    }
}

#[test]
fn a_cpi_guarded_recipient_receives_normally() {
    for d in mints() {
        let h = Harness::deploy(d);
        open_recipient(&h, &d);
        enable(&h, h.ata(), h.recipient(), ExtensionType::CpiGuard);
        assert!(receive(&h).is_ok(), "{d:?}");
        assert_eq!(h.token(h.ata()).amount, 1_000);
    }
}

/// The OFT debits the sender inside a CPI the owner signs, which CpiGuard refuses. The owner can
/// lift the guard at the top level, so a guarded sender disables it around `send` in one
/// transaction and ends with it on again.
#[test]
fn a_cpi_guarded_source_sends_only_with_the_guard_lifted_around_send() {
    for d in mints() {
        let h = Harness::deploy(d);
        assert!(receive(&h).is_ok(), "{d:?}");
        let send = h.send(d.burns_through_manager(), &h.send_endpoint_accounts(0));
        enable(&h, h.ata(), h.recipient(), ExtensionType::CpiGuard);

        assert_eq!(
            h.run(std::slice::from_ref(&send)).program_result,
            token_error(TokenError::CpiGuardTransferBlocked),
            "{d:?}"
        );
        assert_eq!(h.token(h.ata()).amount, 1_000, "a refused send moves nothing");

        let guard = |on| set(&h, h.ata(), h.recipient(), ExtensionType::CpiGuard, on);
        h.ok(&[guard(false), send, guard(true)]);
        assert_eq!(h.token(h.ata()).amount, 900, "{d:?}");
        let data = h.account(h.ata()).data;
        let account = StateWithExtensions::<TokenAccount>::unpack(&data).unwrap();
        assert!(bool::from(account.get_extension::<cpi_guard::CpiGuard>().unwrap().lock_cpi));
    }
}

/// A memo requirement only concerns incoming transfers, so a source with one sends normally.
#[test]
fn a_memo_required_source_sends_normally() {
    for d in mints() {
        let h = Harness::deploy(d);
        assert!(receive(&h).is_ok(), "{d:?}");
        enable(&h, h.ata(), h.recipient(), ExtensionType::MemoTransfer);
        h.ok(&[h.send(d.burns_through_manager(), &h.send_endpoint_accounts(0))]);
        assert_eq!(h.token(h.ata()).amount, 900, "{d:?}");
    }
}

/// A fee-bearing send credits the fee deposit, so a memo requirement there blocks every such send;
/// a CpiGuard there changes nothing.
#[test]
fn a_memo_required_fee_deposit_blocks_fee_bearing_sends() {
    for d in mints() {
        for extension in [ExtensionType::MemoTransfer, ExtensionType::CpiGuard] {
            let h = Harness::deploy(d);
            h.ok(&[
                h.grant_oft_role_ix(OftRole::FeeConfigManager, h.f.admin),
                set_default_fee_bps_ix(&h.f, h.f.admin, 100),
            ]);
            assert!(receive(&h).is_ok(), "{d:?}");
            enable(&h, h.f.fee_deposit, h.f.admin, extension);
            let send = h.send(d.burns_through_manager(), &h.send_endpoint_accounts(0));
            if extension == ExtensionType::MemoTransfer {
                assert_eq!(
                    h.run(std::slice::from_ref(&send)).program_result,
                    token_error(TokenError::NoMemo)
                );
                h.ok(&[set(&h, h.f.fee_deposit, h.f.admin, extension, false)]);
            }
            h.ok(&[send]);
            assert_eq!(h.token(h.f.fee_deposit).amount, 1, "{d:?} {extension:?}");
        }
    }
}

/// A blocked recipient's credit goes to the redirect escrow, so a memo requirement there holds
/// every redirected receive; a CpiGuard there changes nothing.
#[test]
fn a_memo_required_redirect_escrow_holds_redirected_receives() {
    for d in mints() {
        for extension in [ExtensionType::MemoTransfer, ExtensionType::CpiGuard] {
            let h = Harness::deploy(d);
            h.ok(&[h.membership(h.recipient(), false, true)]);
            enable(&h, h.f.fee_deposit, h.f.admin, extension);
            if extension == ExtensionType::MemoTransfer {
                assert_eq!(receive(&h), token_error(TokenError::NoMemo), "{d:?}");
                h.ok(&[set(&h, h.f.fee_deposit, h.f.admin, extension, false)]);
            }
            assert!(receive(&h).is_ok(), "{d:?} {extension:?}");
            assert_eq!(h.token(h.f.fee_deposit).amount, 1_000, "redirected: {d:?} {extension:?}");
        }
    }
}
