//! SEND through the real OFT, TokenManager, hooks, Endpoint and SimpleMessageLib. Debit
//! arithmetic (fee, dust, slippage) and rate-limit transitions are unit-tested beside the code.

use crate::harness::*;
use console_oft::state::{
    RateLimit, RateLimitConfig,
    RoleType::{Pauser, Unpauser},
};
use spl_token_2022_interface::error::TokenError;

/// A received balance to send from, on a Token-2022 BurnMint OFT without ACL.
fn funded(hook: bool, pb: bool) -> Harness {
    let h = Harness::with_pb(false, hook, pb);
    h.verify();
    h.ok(&[h.receive()]);
    h
}

/// Pause is per destination: the default applies unless a per-EID override lifts or imposes it.
#[test]
fn a_paused_destination_rejects_sends() {
    let h = funded(false, false);
    let endpoint = h.send_endpoint_accounts(0);
    let id = u128::from(DST_EID);
    let assert_paused = |h: &Harness| {
        let source = h.account(h.ata());
        assert_eq!(h.run(&[h.send(false, &endpoint)]).program_result, failure(OFTError::Paused));
        assert_eq!(h.account(h.ata()), source);
    };

    h.ok(&[set_default_paused_ix(&h.f, h.f.admin, Pauser, true)]);
    assert_paused(&h);
    h.ok(&[set_paused_ix(&h.f, h.f.admin, Unpauser, id, Some(false))]);
    h.ok(&[h.send(false, &endpoint)]);

    h.ok(&[
        set_default_paused_ix(&h.f, h.f.admin, Unpauser, false),
        set_paused_ix(&h.f, h.f.admin, Pauser, id, Some(true)),
    ]);
    assert_paused(&h);
    assert_eq!((h.token(h.ata()).amount, h.outbound_nonce()), (900, 1));
}

/// A TransferFee extension at 0 bps is inert. A non-zero fee is refused once its epoch starts:
/// escrow would receive less than the amount the destination credits.
#[test]
fn a_live_token_2022_transfer_fee_blocks_sends() {
    let mut h = Harness::with_transfer_fee(0);
    h.verify();
    h.ok(&[h.receive()]);
    let endpoint = h.send_endpoint_accounts(0);
    h.ok(&[h.send(false, &endpoint)]);

    h.ok(&[spl_token_2022_interface::extension::transfer_fee::instruction::set_transfer_fee(
        &token2022::ID,
        &h.f.token_mint,
        &h.f.admin,
        &[],
        100,
        u64::MAX,
    )
    .unwrap()]);
    // Token-2022 schedules the new fee two epochs out.
    h.ok(&[h.send(false, &endpoint)]);
    h.f.context.mollusk.sysvars.clock.epoch += 2;
    let source = h.account(h.ata());
    assert_eq!(
        h.run(&[h.send(false, &endpoint)]).program_result,
        failure(OFTError::TransferFeeActive)
    );
    assert_eq!((h.account(h.ata()), h.outbound_nonce()), (source, 2));
}

#[test]
fn send_rejects_a_minimum_above_the_amount_delivered_after_fee() {
    let h = funded(false, false);
    h.set_default_fee_bps(1_000); // 10% of 100
    let endpoint = h.send_endpoint_accounts(0);
    let send = |min| with_send_params(h.send(false, &endpoint), |p| p.min_amount_ld = min);
    assert_eq!(h.run(&[send(91)]).program_result, failure(OFTError::SlippageExceeded));
    h.ok(&[send(90)]);
    assert_eq!((h.token(h.ata()).amount, h.token(h.f.fee_deposit).amount), (900, 10));
}

/// LockUnlock never changes supply: receive releases escrowed liquidity, send locks it again.
#[test]
fn lock_unlock_moves_the_escrow_balance_and_never_the_supply() {
    let h = Harness::new(false, false);
    h.f.update_store(|store| store.oft_type = ::oft::types::OftType::LockUnlock);
    h.credit(h.f.oft_escrow, 1_000); // liquidity locked by earlier sends
    h.verify();
    h.ok(&[h.receive()]);
    assert_eq!(
        (h.token(h.ata()).amount, h.token(h.f.oft_escrow).amount, h.supply()),
        (1_000, 0, 1_000)
    );
    h.ok(&[h.send(false, &h.send_endpoint_accounts(0))]);
    assert_eq!(
        (h.token(h.ata()).amount, h.token(h.f.oft_escrow).amount, h.supply()),
        (900, 100, 1_000)
    );
}

/// A send that collects nothing (no fee, no dust) needs no usable fee deposit — the frozen account
/// or the omitted slot both work — but a fee-charging send cannot sweep into a frozen one, and
/// rolls back entirely.
#[test]
fn a_frozen_fee_deposit_blocks_only_sends_that_charge_a_fee() {
    let h = funded(true, true);
    let endpoint = h.send_endpoint_accounts(0);
    h.ok(&[token::freeze_account(
        &h.token_program,
        &h.f.fee_deposit,
        &h.f.token_mint,
        &h.f.admin,
        &[],
    )
    .unwrap()]);
    h.ok(&[h.send(true, &endpoint)]);
    let mut omitted = h.send(true, &endpoint);
    let fee_slot = slot_of(&omitted, h.f.fee_deposit);
    omitted.accounts[fee_slot] = AccountMeta::new_readonly(program_id(), false);
    h.ok(&[omitted]);
    assert_eq!(h.token(h.ata()).amount, 800);

    h.set_default_fee_bps(1_000);
    let (source, mint, nonce) = (h.account(h.ata()), h.account(h.f.token_mint), h.outbound_nonce());
    assert_eq!(
        h.run(&[h.send(true, &endpoint)]).program_result,
        failure(TokenError::AccountFrozen as u32)
    );
    assert_eq!((h.account(h.ata()), h.account(h.f.token_mint)), (source, mint));
    assert_eq!((h.outbound_nonce(), h.token(h.f.oft_escrow).amount), (nonce, 0));
}

/// Sends charge the state the rate limiter selects — the default limiter in global mode, else the
/// per-EID one, with its own limit only when it overrides — and leave it untouched while globally
/// disabled; an exceeded limit rolls back.
#[test]
fn send_charges_the_selected_rate_state_and_skips_it_while_globally_disabled() {
    for (global, override_config) in [(true, false), (false, false), (false, true)] {
        let h = funded(false, false);
        configure_profile(&h, false);
        let per_eid = rate_limit_pda(&h.f.oft_store, DST_EID.into());
        h.seed(
            per_eid,
            RateLimit {
                config: RateLimitConfig {
                    override_default_config: override_config,
                    outbound_limit: if override_config { 100 } else { 0 },
                    inbound_limit: 100,
                    outbound_window: 60,
                    inbound_window: 60,
                    ..Default::default()
                },
                state: Default::default(),
            },
        );
        let toggle = |disabled| set_rate_limit_global_config_ix(&h.f, h.f.admin, global, disabled);
        let outbound = |key| read_account::<RateLimit>(&h.f.context, &key).state.outbound_usage;
        let endpoint = h.send_endpoint_accounts(0);
        let (selected, untouched) = if global {
            (h.f.default_rate_limit, per_eid)
        } else {
            (per_eid, h.f.default_rate_limit)
        };

        h.ok(&[toggle(false), h.send(false, &endpoint)]);
        assert_eq!((outbound(selected), outbound(untouched)), (100, 0));

        let before = h.account(selected);
        h.ok(&[toggle(true), h.send(false, &endpoint)]);
        assert_eq!(h.account(selected), before);

        h.ok(&[toggle(false)]);
        if override_config {
            let result = h.run(&[h.send(false, &endpoint)]).program_result;
            assert_eq!(result, failure(OFTError::RateLimitExceeded));
            assert_eq!(h.account(selected), before);
        } else {
            h.ok(&[h.send(false, &endpoint)]);
            assert_eq!(outbound(selected), 200);
        }
    }
}

/// Screening is receive-side: a blacklisted holder may still send, from any account it owns, and
/// send never loads the policy.
#[test]
fn send_does_not_consult_the_receive_policy() {
    let h = funded(false, false);
    let source = Pubkey::new_unique();
    let account = h.f.context.account_store.borrow_mut().remove(&h.ata()).unwrap();
    h.f.insert(source, account);
    h.ok(&[h.membership(h.recipient(), false, true)]);
    h.f.context.account_store.borrow_mut().remove(&h.pubkey_policy);

    h.ok(&[h.send_from(source, false, &h.send_endpoint_accounts(0))]);
    assert_eq!((h.token(source).amount, h.outbound_nonce()), (900, 1));
}

#[test]
fn send_requires_an_unfrozen_source_owned_by_the_signer() {
    let h = funded(false, false);
    let endpoint = h.send_endpoint_accounts(0);
    let freeze =
        token::freeze_account(&h.token_program, &h.ata(), &h.f.token_mint, &h.f.admin, &[]);
    h.ok(&[freeze.unwrap()]);
    assert_eq!(
        h.run(&[h.send(false, &endpoint)]).program_result,
        failure(TokenError::AccountFrozen as u32)
    );
    let thaw = token::thaw_account(&h.token_program, &h.ata(), &h.f.token_mint, &h.f.admin, &[]);
    h.ok(&[thaw.unwrap()]);

    // Another signer (with its own exemption PDA, so seeds pass) cannot spend the source.
    let mut send = h.send(false, &endpoint);
    let exemption = rate_limit_address_exemption_pda(&h.f.oft_store, &h.recipient());
    let (signer_slot, exemption_slot) = (slot_of(&send, h.recipient()), slot_of(&send, exemption));
    send.accounts[signer_slot].pubkey = h.f.admin;
    send.accounts[exemption_slot].pubkey =
        rate_limit_address_exemption_pda(&h.f.oft_store, &h.f.admin);
    assert_eq!(
        h.run(&[send]).program_result,
        failure(anchor_lang::error::ErrorCode::ConstraintTokenOwner)
    );
    assert_eq!((h.token(h.ata()).amount, h.token(h.f.oft_escrow).amount), (1_000, 0));
}

#[test]
fn permissioned_burn_send_is_approved_by_the_token_manager() {
    let h = funded(false, true);
    let result = h.ok(&[h.send(true, &h.send_endpoint_accounts(0))]);
    h.assert_burn_path(&result, true);
    assert_eq!((h.token(h.ata()).amount, h.token(h.f.oft_escrow).amount), (900, 0));
    assert_eq!((h.supply(), h.outbound_nonce()), (900, 1));
}

/// The burn path follows the mint's live PermissionedBurn state, never the supplied accounts:
/// omitting the manager accounts fails, and so does a manager whose Burner role was revoked.
#[test]
fn permissioned_burn_cannot_be_skipped_or_approved_without_the_burner_role() {
    let h = funded(false, true);
    let endpoint = h.send_endpoint_accounts(0);
    assert_eq!(
        h.run(&[h.send(false, &endpoint)]).program_result,
        failure(OFTError::MissingBurnAccounts)
    );
    h.f.context.account_store.borrow_mut().remove(&role(
        h.token_manager,
        RoleType::Burner,
        h.f.oft_escrow,
    ));
    assert!(!h.run(&[h.send(true, &endpoint)]).program_result.is_ok());
    assert_eq!((h.token(h.ata()).amount, h.token(h.f.oft_escrow).amount), (1_000, 0));
}

/// The manager is admin-selected and upgradeable, so it never sees `oft_store` (the mint authority
/// and the OApp's identity): only the escrow, approved as its own delegate for the send's amount.
#[test]
fn the_manager_never_receives_the_oft_stores_signature() {
    let h = funded(false, true);
    let result = h.run(&[h.send(true, &h.send_endpoint_accounts(0))]);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    let keys = result.message.as_ref().unwrap().account_keys();
    let manager_calls: Vec<_> = result
        .inner_instructions
        .iter()
        .flatten()
        .filter(|inner| {
            keys[usize::from(inner.instruction.program_id_index)] == host(token_manager::ID)
        })
        .collect();
    assert!(!manager_calls.is_empty());
    for call in manager_calls {
        assert!(call.instruction.accounts.iter().all(|&i| keys[usize::from(i)] != h.f.oft_store));
    }
    let escrow = h.token(h.f.oft_escrow);
    assert_eq!((escrow.delegate, escrow.delegated_amount), (None.into(), 0));
    assert_eq!(h.supply(), 900);
}

#[test]
fn caller_cannot_select_standard_burn_by_substituting_token_program() {
    let h = funded(false, true);
    let mut send = h.send(false, &h.send_endpoint_accounts(0));
    let token_program = slot_of(&send, token2022::ID);
    send.accounts[token_program].pubkey = mollusk_svm_programs_token::token::ID;
    assert!(!h.run(&[send]).program_result.is_ok());
    assert_eq!((h.token(h.ata()).amount, h.token(h.f.oft_escrow).amount), (1_000, 0));
}

/// SPL mints and Token-2022 mints whose PermissionedBurn was renounced burn directly, without the
/// manager accounts.
#[test]
fn spl_and_renounced_permissioned_burn_sends_burn_directly() {
    for (token_program, pb) in [
        (mollusk_svm_programs_token::token::ID, false),
        (token2022::ID, false),
        (token2022::ID, true),
    ] {
        let h = Harness::with_token_program(token_program, false, false, pb);
        h.verify();
        h.ok(&[h.receive()]);
        if pb {
            // Renounce PB: the TokenManager hands it to the admin, who nulls it natively.
            h.ok(&[
                ix(
                    token_manager::ID,
                    token_manager::accounts::SetNativeAuthority {
                        authority: to_program_pubkey(&h.f.admin),
                        token_manager: to_program_pubkey(&h.token_manager),
                        signer: to_program_pubkey(&signer(
                            h.token_manager,
                            SignerKind::PermissionedBurn,
                        )),
                        multisig: None,
                        mint: to_program_pubkey(&h.f.token_mint),
                        mint_config: None,
                        acl_program: None,
                        token_program: to_program_pubkey(&token2022::ID),
                        role_member: to_program_pubkey(&role(
                            h.token_manager,
                            RoleType::DefaultAdmin,
                            h.f.admin,
                        )),
                        event_authority: to_program_pubkey(&event(host(token_manager::ID))),
                        program: token_manager::ID,
                    },
                    token_manager::instruction::SetNativeAuthority {
                        kind: SignerKind::PermissionedBurn,
                        new_authority: to_program_pubkey(&h.f.admin),
                    },
                ),
                token::set_authority(
                    &token2022::ID,
                    &h.f.token_mint,
                    None,
                    token::AuthorityType::PermissionedBurn,
                    &h.f.admin,
                    &[],
                )
                .unwrap(),
            ]);
        }
        let result = h.ok(&[h.send(false, &h.send_endpoint_accounts(0))]);
        h.assert_burn_path(&result, false);
        assert_eq!(
            (h.token(h.ata()).amount, h.token(h.f.oft_escrow).amount, h.supply()),
            (900, 0, 900)
        );
    }
}

#[test]
fn send_rolls_back_the_debit_and_burn_when_the_endpoint_send_fails() {
    let h = funded(false, true);
    // The actual send library requires one lamport, but send supplies zero.
    assert!(!h.run(&[h.send(true, &h.send_endpoint_accounts(1))]).program_result.is_ok());
    assert_eq!((h.token(h.ata()).amount, h.supply(), h.outbound_nonce()), (1_000, 1_000, 0));
}

/// `send`'s remaining accounts are [lock hooks][fee hooks][Endpoint]; each hook group is framed
/// by its manifest, including absent and empty ones.
#[test]
fn send_frames_lock_fee_and_endpoint_groups_for_each_hook_manifest_kind() {
    for kind in [HookFixtureKind::Absent, HookFixtureKind::Empty, HookFixtureKind::DestinationSeeds]
    {
        let mut h = Harness::with_pb(false, true, true);
        h.use_hook_fixture(kind);
        h.verify();
        h.ok(&[h.receive()]);
        h.set_default_fee_bps(1_000);
        h.ok(&[h.send(true, &h.send_endpoint_accounts(0))]);
        assert_eq!(
            (h.token(h.ata()).amount, h.token(h.f.fee_deposit).amount),
            (900, 10),
            "{kind:?}"
        );
        assert_eq!((h.token(h.f.oft_escrow).amount, h.outbound_nonce()), (0, 1), "{kind:?}");
    }
}
