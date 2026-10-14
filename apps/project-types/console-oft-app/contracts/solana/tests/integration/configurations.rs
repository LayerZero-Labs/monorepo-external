//! Which token configurations a Console OFT can be deployed on, proven by deploying each through
//! the real programs (`Harness::deploy`) and running a first receive to a new recipient and a
//! send back.
//!
//! Configurations that take the same path through the programs are one pattern:
//!
//! - **Plain**: SPL Token; Token-2022 with no extensions, with extensions the OFT never reads
//!   (MintCloseAuthority, InterestBearing, MetadataPointer, GroupPointer), with a 0 bps
//!   TransferFee, or with a PermanentDelegate on the root. No setup beyond init and peers.
//! - **Transfer hook**: the hook runs on every escrow transfer; needs the hook manifest.
//!   `init_console_oft` caches the mint's hook program, so `sync_transfer_hook_program` is needed
//!   only when the hook changes after init.
//! - **Token ACL**: new accounts start frozen. The escrow is thawed after init, the recipient's ATA
//!   is created and thawed inside `lz_receive`; needs `init_acl`, a selected policy and
//!   `sync_acl_gating_program`.
//! - **PermissionedBurn**: BurnMint sends burn through the root's `permissioned_burn`; needs the
//!   escrow's Burner grant and `set_token_manager`. LockUnlock never burns.
//! - **Pausable**: works unpaused; while paused, traffic fails and payloads stay retryable.
//! - **Frozen without Token ACL**: new recipients cannot be thawed inline, so credits redirect or
//!   fail with `CreditBlocked`.
//!
//! The full issuer stack combines the first five. Unsupported configurations deploy but refuse
//! traffic cleanly, leaving the payload retryable.
use crate::{deploy::Deployment, harness::*};

/// A first receive of 1_000 to a recipient with no account, through the program's own plan, then a
/// send of 100 back.
fn round_trip(d: Deployment) -> Harness {
    let h = Harness::deploy(d);
    h.verify();
    h.ok(&h.instructions());
    let recipient = h.token(h.ata());
    assert_eq!(recipient.amount, 1_000, "{d:?}");
    assert_eq!(recipient.state, AccountState::Initialized, "thawed inline: {d:?}");
    assert_eq!(h.token(h.f.oft_escrow).amount, 0, "{d:?}");
    assert_eq!(h.supply(), 1_000, "{d:?}");
    assert!(h.account(h.payload()).data.is_empty(), "payload cleared: {d:?}");

    let nonce = h.outbound_nonce();
    let result = h.ok(&[h.send(d.burns_through_manager(), &h.send_endpoint_accounts(0))]);
    assert_eq!(h.outbound_nonce(), nonce + 1, "{d:?}");
    assert_eq!(h.token(h.ata()).amount, 900, "{d:?}");
    if d.lock_unlock {
        assert_eq!(h.token(h.f.oft_escrow).amount, 100, "{d:?}");
        assert_eq!(h.supply(), 1_000, "{d:?}");
    } else {
        assert_eq!(h.token(h.f.oft_escrow).amount, 0, "{d:?}");
        assert_eq!(h.supply(), 900, "{d:?}");
        h.assert_burn_path(&result, d.burns_through_manager());
    }
    h
}

fn both_custody_modes(d: Deployment) -> [Deployment; 2] {
    [d.custody(false), d.custody(true)]
}

#[test]
fn plain_configurations_need_no_setup_beyond_init() {
    for d in [
        Deployment::spl_token(),
        Deployment::default(),
        Deployment { inert: true, ..Deployment::default() },
        Deployment { transfer_fee_bps: Some(0), ..Deployment::default() },
        Deployment { permanent_delegate: true, ..Deployment::default() },
    ] {
        for d in both_custody_modes(d) {
            round_trip(d);
        }
    }
}

#[test]
fn a_transfer_hook_mint_round_trips() {
    for d in both_custody_modes(Deployment { hook: true, ..Deployment::default() }) {
        round_trip(d);
    }
}

/// The escrow is created frozen and thawed permissionlessly after init (`Harness::deploy`
/// asserts both); the new recipient's ATA is created and thawed inside `lz_receive`.
#[test]
fn a_token_acl_mint_round_trips_with_the_escrow_and_recipient_thawed() {
    for d in both_custody_modes(Deployment { acl: true, ..Deployment::default() }) {
        round_trip(d);
    }
}

#[test]
fn a_permissioned_burn_mint_burns_through_the_root_and_locks_without_it() {
    for d in both_custody_modes(Deployment { pb: true, ..Deployment::default() }) {
        round_trip(d);
    }
}

#[test]
fn a_burn_mint_authority_can_be_a_one_of_n_multisig_including_the_store() {
    for d in [
        Deployment { multisig_mint_authority: true, ..Deployment::default() },
        Deployment {
            multisig_mint_authority: true,
            acl: true,
            hook: true,
            ..Deployment::default()
        },
    ] {
        round_trip(d);
    }
}

/// While the mint is paused both directions fail and the payload stays retryable; after resuming,
/// the same message delivers.
#[test]
fn a_pausable_mint_holds_traffic_while_paused() {
    for d in both_custody_modes(Deployment { pausable: true, ..Deployment::default() }) {
        let h = Harness::deploy(d);
        h.verify();
        let plan = h.instructions();
        let pause = |paused: bool| {
            let toggle = if paused {
                spl_token_2022_interface::extension::pausable::instruction::pause
            } else {
                spl_token_2022_interface::extension::pausable::instruction::resume
            };
            toggle(&token2022::ID, &h.f.token_mint, &h.f.admin, &[]).unwrap()
        };
        h.ok(&[pause(true)]);
        let payload = h.account(h.payload());
        assert!(!h.run(&plan).program_result.is_ok(), "{d:?}");
        assert_eq!(h.account(h.payload()), payload, "payload must stay retryable");
        h.ok(&[pause(false)]);
        h.ok(&plan);
        assert_eq!(h.token(h.ata()).amount, 1_000);

        h.ok(&[pause(true)]);
        let send = h.send(false, &h.send_endpoint_accounts(0));
        assert!(!h.run(std::slice::from_ref(&send)).program_result.is_ok(), "{d:?}");
        h.ok(&[pause(false), send]);
        assert_eq!(h.token(h.ata()).amount, 900);
    }
}

/// Everything an issuer may turn on at once: Token ACL, the hook, PermissionedBurn, a Permanent
/// Delegate, Pausable, inert extensions, a selected policy and a redirect escrow.
#[test]
fn the_full_issuer_stack_round_trips() {
    let full = Deployment {
        acl: true,
        hook: true,
        pb: true,
        permanent_delegate: true,
        pausable: true,
        inert: true,
        policy: true,
        redirect: true,
        ..Deployment::default()
    };
    for d in both_custody_modes(full) {
        round_trip(d);
    }
}

/// DefaultAccountState Frozen with the native freeze authority: nothing can thaw a new recipient
/// inside `lz_receive`, so its credit goes to the redirect escrow, or fails with `CreditBlocked`
/// without one. A policy selection does not change that; it does not bring Token ACL.
#[test]
fn a_frozen_by_default_mint_without_token_acl_redirects_new_recipients() {
    for redirect in [true, false] {
        for d in both_custody_modes(Deployment {
            frozen_without_acl: true,
            policy: true,
            redirect,
            ..Deployment::default()
        }) {
            let h = Harness::deploy(d);
            h.verify();
            let payload = h.account(h.payload());
            let result = h.run(&h.instructions()).program_result;
            if redirect {
                assert!(result.is_ok(), "{d:?}: {result:?}");
                assert_eq!(h.token(h.f.fee_deposit).amount, 1_000);
                let recipient = h.token(h.ata());
                assert_eq!((recipient.amount, recipient.state), (0, AccountState::Frozen));
            } else {
                assert_eq!(result, failure(OFTError::CreditBlocked), "{d:?}");
                assert_eq!(h.account(h.payload()), payload, "payload must stay retryable");
            }
        }
    }
}

/// Configurations the OFT cannot carry deploy, but refuse the first receive and keep the payload:
/// a live transfer fee (the escrow would hold less than the message's amount) and NonTransferable.
#[test]
fn unsupported_configurations_deploy_but_refuse_traffic() {
    let cases = [
        (
            Deployment { transfer_fee_bps: Some(100), ..Deployment::default() },
            u32::from(OFTError::TransferFeeActive),
        ),
        (
            Deployment { non_transferable: true, ..Deployment::default() },
            spl_token_2022_interface::error::TokenError::NonTransferable as u32,
        ),
    ];
    for (d, error) in cases {
        for d in both_custody_modes(d) {
            let h = Harness::deploy(d);
            h.verify();
            let payload = h.account(h.payload());
            let result = h.run(&h.instructions()).program_result;
            assert_eq!(
                result,
                TransactionProgramResult::Failure(0, ProgramError::Custom(error)),
                "{d:?}"
            );
            assert_eq!(h.account(h.payload()), payload, "payload must stay retryable");
        }
    }
}
