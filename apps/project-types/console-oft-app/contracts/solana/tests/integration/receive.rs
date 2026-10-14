//! RECEIVE: the executor-planned `lz_receive` through the real OFT, ACL, TokenManager gate, pubkey
//! policy, hooks and Endpoint clear. Plans are produced by the program's own planner and
//! executed as one atomic transaction, as the Executor submits them.

use crate::harness::*;

#[test]
fn first_time_recipient_gets_an_ata_and_the_credit() {
    let h = Harness::new(false, false);
    h.verify();
    h.ok(&[h.receive()]);
    h.delivered(h.ata());
}

/// An all-zero `to` is `Pubkey::default()`, the System Program: a real address here, not a
/// sentinel as on EVM (which mints to `0xdead` and reports 0). Its ATA is created and credited,
/// and `OFTReceived` reports the full amount (`Harness::ok` checks the event).
#[test]
fn an_all_zero_recipient_is_credited_and_reported_in_full() {
    let mut h = Harness::new(false, false);
    h.f.user = Pubkey::default();
    h.verify();
    h.ok(&[h.receive()]);
    h.delivered(h.ata());
}

/// The peer check is the OApp's authentication of the source: a message whose sender is not the
/// configured peer for its source EID is refused, and the payload stays.
#[test]
fn receive_rejects_a_message_whose_sender_is_not_the_peer() {
    let h = Harness::new(false, false);
    h.verify();
    let mut receive = h.receive();
    receive.data = console_oft::instruction::LzReceive {
        params: LzReceiveParams { sender: [0x45; 32], ..h.params() },
    }
    .data();
    let payload = h.account(h.payload());
    assert_eq!(h.run(&[receive]).program_result, failure(OFTError::InvalidSender));
    assert_eq!(h.account(h.payload()), payload);
}

/// Receive charges the source EID's inbound limiter, and not at all for an exempt recipient.
#[test]
fn receive_charges_the_source_eids_inbound_limit_unless_the_recipient_is_exempt() {
    use console_oft::state::{RateLimit, RateLimitConfig};
    for exempt in [false, true] {
        let h = Harness::new(false, false);
        h.f.update_store(|store| store.is_globally_disabled = false);
        let per_eid = rate_limit_pda(&h.f.oft_store, DST_EID.into());
        h.seed(
            per_eid,
            RateLimit {
                config: RateLimitConfig {
                    override_default_config: true,
                    address_exemption_enabled: true,
                    // An exempt recipient is delivered even with no inbound capacity at all.
                    inbound_limit: if exempt { 0 } else { 1_000 },
                    inbound_window: 60,
                    ..Default::default()
                },
                state: Default::default(),
            },
        );
        if exempt {
            h.ok(&[set_rate_limit_address_exemption_ix(&h.f, h.f.admin, h.recipient(), true)]);
        }
        h.verify();
        let default_limiter = h.account(h.f.default_rate_limit);
        h.ok(&[h.receive()]);
        h.delivered(h.ata());
        let charged = read_account::<RateLimit>(&h.f.context, &per_eid).state.inbound_usage;
        assert_eq!(charged, if exempt { 0 } else { 1_000 });
        assert_eq!(h.account(h.f.default_rate_limit), default_limiter);
    }
}

#[test]
fn acl_create_thaw_receive_is_one_atomic_transaction() {
    let h = Harness::new(true, false);
    h.verify();
    let plan = h.instructions();
    assert_eq!(plan.len(), 1);
    let result = h.ok(&plan);
    h.assert_inline_thaw(&result, true);
    h.delivered(h.ata());
    assert_eq!(h.token(h.ata()).state, AccountState::Initialized);
}

#[test]
fn existing_unfrozen_destination_does_not_call_acl() {
    let h = Harness::new(true, false);
    h.ok(&[h.create_ata(), h.thaw()]); // Native control, no OFT wrapper.
    h.verify();
    let result = h.ok(&h.instructions());
    h.assert_inline_thaw(&result, false);
    h.delivered(h.ata());
}

#[test]
fn eligible_recipient_is_thawed_inline_instead_of_being_diverted() {
    let h = Harness::new(true, false);
    h.redirect();
    h.verify();
    h.ok(&h.instructions());
    h.delivered(h.ata());
    assert_eq!(h.token(h.ata()).state, AccountState::Initialized);
    assert_eq!(h.token(h.f.fee_deposit).amount, 0, "must not divert an eligible recipient");
}

#[test]
fn funded_frozen_destination_retains_native_hold() {
    let h = Harness::new(true, false);
    h.ok(&[h.create_ata()]);
    h.credit(h.ata(), 1); // Fixture representing an issuer-frozen, funded account.
    h.redirect();
    h.verify();
    let result = h.ok(&h.instructions());
    h.assert_inline_thaw(&result, false);
    assert_eq!(h.token(h.ata()).state, AccountState::Frozen);
    assert_eq!(h.token(h.ata()).amount, 1);
    assert_eq!(h.token(h.f.fee_deposit).amount, 1_000);
}

/// A live Token-2022 transfer fee refuses the credit and keeps the payload: the recipient would get
/// less than the amount reported to a composer.
#[test]
fn a_live_token_2022_transfer_fee_blocks_receive() {
    let h = Harness::with_transfer_fee(100);
    h.verify();
    let payload = h.account(h.payload());
    assert_eq!(h.run(&[h.receive()]).program_result, failure(OFTError::TransferFeeActive));
    assert!(h.account(h.ata()).data.is_empty());
    assert_eq!(h.account(h.payload()), payload);
}

#[test]
fn blocked_recipient_without_redirect_fails_and_keeps_the_payload() {
    let h = Harness::new(true, false);
    h.ok(&[h.membership(h.recipient(), false, true)]);
    h.verify();
    let payload = h.account(h.payload());
    assert_eq!(
        h.run(&h.instructions()).program_result,
        TransactionProgramResult::Failure(
            0,
            ProgramError::Custom(console_oft::errors::OFTError::CreditBlocked.into())
        )
    );
    assert!(h.account(h.ata()).data.is_empty());
    assert_eq!(h.account(h.payload()), payload);
}

#[test]
fn receive_failure_after_successful_thaw_rolls_back_entire_transaction() {
    let h = Harness::new(true, false);
    h.verify();
    // Re-enable the fixture's zero-capacity limiter through the real authorized instruction.
    // Credit checks it AFTER inline thaw and Endpoint clear.
    h.ok(&[set_rate_limit_global_config_ix(&h.f, h.f.admin, true, false)]);
    let receive = h.receive();
    let payload = h.account(h.payload());
    let result = h.run(&[receive]);
    assert_eq!(
        result.program_result,
        TransactionProgramResult::Failure(
            0,
            ProgramError::Custom(console_oft::errors::OFTError::RateLimitExceeded.into())
        )
    );
    h.assert_inline_thaw(&result, true);
    assert!(result.inner_instructions.iter().flatten().any(|inner| inner
        .instruction
        .data
        .starts_with(endpoint::client::args::Clear::DISCRIMINATOR)));
    assert!(h.account(h.ata()).data.is_empty());
    assert_eq!(h.account(h.payload()), payload);
}

/// Without a transfer hook, a closed redirect escrow blocks only redirects: ordinary delivery never
/// loads it. With a hook, both destinations' hook groups are validated on every delivery.
#[test]
fn a_closed_redirect_escrow_does_not_block_ordinary_delivery() {
    let h = Harness::new(false, false);
    h.redirect();
    h.verify();
    let plan = h.instructions();
    h.f.context.account_store.borrow_mut().remove(&h.f.fee_deposit);
    h.ok(&plan);
    h.delivered(h.ata());
}

#[test]
fn omitting_optional_acl_accounts_cannot_force_redirect() {
    // lz_receive is permissionless and the ACL predicate accounts are optional in the struct, so
    // a caller can pass Anchor's None sentinel (the program id) for them. If that turned the guard
    // off ("not thawable" => safe to redirect), a griefer would divert an eligible recipient's
    // funds to escrow and consume the payload. The guard gates on the pinned mint instead, so an
    // ACL-governed mint makes the accounts mandatory: omitting them errors, preserving the payload.
    for enabled in [true, false] {
        let h = Harness::new(true, false);
        h.set_permissionless_thaw(enabled);
        h.redirect();
        h.verify();
        let payload = h.account(h.payload());
        let slots = lz_receive_slots();
        let screening =
            [&[slots.pubkey_policy, slots.pubkey_policy_record][..], &slots.acl].concat();
        for index in screening {
            let mut receive = h.receive();
            receive.accounts[index] = AccountMeta::new_readonly(program_id(), false);
            let result = h.run(&[receive]).program_result;
            assert!(!result.is_ok(), "omitted slot {index}, enabled={enabled}");
            if index == slots.acl[4] {
                // An omitted gate program is rejected before the thaw CPI is built.
                assert_eq!(result, failure(OFTError::InvalidAclAccounts));
            }
            assert!(h.account(h.ata()).data.is_empty());
            assert_eq!(h.token(h.f.fee_deposit).amount, 0);
            assert_eq!(h.account(h.payload()), payload);
        }
    }
}

#[test]
fn acl_governed_mint_with_screening_off_redirects_instead_of_stalling() {
    // "ACL for manual freeze control, OFT screening off": set_pubkey_policy supports clearing
    // pubkey_policy to None on an ACL-governed mint. No policy means no automatic activation.
    let h = Harness::new(true, false);
    h.redirect();
    h.verify();
    // Clear the OFT's pubkey policy while the mint stays ACL-governed.
    h.ok(&[set_policy(&h, None)]);
    let receive = h.receive();
    assert!(lz_receive_slots()
        .acl
        .iter()
        .all(|slot| receive.accounts[*slot].pubkey == program_id()
            && !receive.accounts[*slot].is_writable));
    let result = h.ok(&[receive]);
    h.assert_inline_thaw(&result, false);
    h.delivered(h.f.fee_deposit);
    assert_eq!(h.token(h.ata()).amount, 0, "eligible recipient's own ATA is not credited");
}

#[test]
fn disabled_permissionless_thaw_redirects_eligible_recipient_instead_of_stalling() {
    // A genuine issuer-disabled path is ineligible, not malformed, and retains redirect behavior.
    let h = Harness::new(true, false);
    h.set_permissionless_thaw(false);
    h.redirect();
    h.verify();
    h.ok(&[h.receive()]);
    h.delivered(h.f.fee_deposit);
    assert_eq!(h.token(h.ata()).amount, 0, "the eligible recipient's own ATA is not credited");
}

#[test]
fn live_policy_change_redirects_an_already_resolved_receive_plan() {
    let h = Harness::new(false, false);
    h.redirect();
    h.verify();
    let receive = h.receive();
    h.ok(&[h.membership(h.recipient(), false, true)]);
    h.ok(&[receive]);
    h.delivered(h.f.fee_deposit);
    assert_eq!(h.token(h.ata()).amount, 0);
}

/// One live `set_mode` is observed by every consumer bound to the policy: OFT receive screening,
/// the ACL gate's permissionless thaw, and the transfer hook on send.
#[test]
fn a_mode_switch_is_observed_by_the_oft_the_acl_gate_and_the_hook() {
    // Whitelist, recipient not listed: blocked everywhere. The redirect is itself a hooked
    // transfer, so the OFT store and the redirect escrow's owner must be whitelisted for it.
    let h = Harness::new(true, true);
    h.redirect();
    h.ok(&[
        h.set_mode(PubkeyPolicyMode::Whitelist),
        h.membership(h.f.oft_store, true, true),
        h.membership(h.f.admin, true, true),
    ]);
    h.verify();
    let result = h.ok(&h.instructions());
    h.assert_inline_thaw(&result, false);
    h.delivered(h.f.fee_deposit);
    assert_eq!(
        h.run(&[h.create_ata(), h.thaw()]).program_result,
        TransactionProgramResult::Failure(
            1,
            ProgramError::Custom(pubkey_policy_interface::PolicyError::Blocked.into())
        )
    );

    // Whitelisting the recipient and the OFT escrow owner lets all three through; dropping the
    // recipient from the whitelist blocks its next send in the hook.
    let h = Harness::new(true, true);
    h.ok(&[h.set_mode(PubkeyPolicyMode::Whitelist)]);
    h.ok(&[h.membership(h.recipient(), true, true), h.membership(h.f.oft_store, true, true)]);
    h.verify();
    let result = h.ok(&h.instructions());
    h.assert_inline_thaw(&result, true);
    h.delivered(h.ata());
    h.ok(&[h.membership(h.recipient(), true, false)]);
    assert_eq!(
        h.run(&[h.send(false, &h.send_endpoint_accounts(0))]).program_result,
        TransactionProgramResult::Failure(
            0,
            ProgramError::Custom(pubkey_policy_interface::PolicyError::Blocked.into())
        )
    );
    assert_eq!(h.token(h.ata()).amount, 1_000);
}

/// With redirect configured both credit candidates are planned; whichever execution picks — the
/// recipient, or the escrow once the recipient is blocked after planning — runs its own hook
/// group, under absent, empty and destination-seeded manifests.
#[test]
fn receive_executes_either_planned_candidate_for_each_hook_manifest_kind() {
    for kind in [HookFixtureKind::Absent, HookFixtureKind::Empty, HookFixtureKind::DestinationSeeds]
    {
        for blocked in [false, true] {
            let mut h = Harness::new(false, true);
            h.use_hook_fixture(kind);
            h.redirect();
            h.verify();
            let receive = h.receive();
            if blocked {
                h.ok(&[h.membership(h.recipient(), false, true)]);
            }
            let result = h.ok(&[receive]);
            h.delivered(if blocked { h.f.fee_deposit } else { h.ata() });
            let keys = result.message.as_ref().unwrap().account_keys();
            assert!(result
                .inner_instructions
                .iter()
                .flatten()
                .any(|inner| keys[usize::from(inner.instruction.program_id_index)]
                    == h.hook_program()));
        }
    }
}

#[test]
fn hook_planning_requires_live_inputs_and_execution_rejects_malformed_candidates() {
    let h = Harness::new(false, true);
    h.redirect();
    h.verify();
    // The optional manifest and redirect inputs cannot suppress a live hook's groups.
    for key in [h.hook_manifest(), h.f.fee_deposit] {
        let mut planner = h.planner();
        let slot = slot_of(&planner, key);
        planner.accounts[slot].pubkey = program_id();
        assert!(!h.f.context.process_instruction(&planner).program_result.is_ok());
    }
    let receive = h.receive();
    let hook_start = receive.accounts.iter().position(|a| a.pubkey == h.hook_program()).unwrap();
    let hook_count = (receive.accounts.len() - hook_start) / 2;
    for case in 0..5 {
        let mut bad = receive.clone();
        match case {
            0 => {
                bad.accounts.remove(hook_start + 1);
            },
            1 => bad.accounts[hook_start + hook_count].pubkey = h.f.admin,
            2 => bad.accounts[hook_start + hook_count + 1].pubkey = h.f.admin,
            3 => {
                bad.accounts.pop();
            },
            _ => bad.accounts.push(AccountMeta::new_readonly(h.f.admin, false)),
        }
        assert!(!h.run(&[bad]).program_result.is_ok(), "malformed case {case}");
        assert!(!h.account(h.payload()).data.is_empty());
    }
    h.ok(&[receive]);
    h.delivered(h.ata());
}

#[test]
fn hook_manifest_is_live_and_first_party_policy_cannot_be_skipped() {
    let mut h = Harness::new(false, true);
    h.use_hook_fixture(HookFixtureKind::Absent);
    h.verify();
    let stale_plan = h.receive();
    h.use_hook_fixture(HookFixtureKind::DestinationSeeds);
    assert!(!h.run(&[stale_plan]).program_result.is_ok());
    assert!(!h.account(h.payload()).data.is_empty());
    h.ok(&[h.receive()]);
    h.delivered(h.ata());

    // First-party hook before manifest initialization must still fail closed inside the hook.
    let h = Harness::new(false, true);
    let manifest = h.hook_manifest();
    let initialized = h.account(manifest);
    h.f.context.account_store.borrow_mut().insert(manifest, Account::default());
    h.verify();
    assert!(!h.run(&[h.receive()]).program_result.is_ok());
    assert!(!h.account(h.payload()).data.is_empty());
    h.f.context.account_store.borrow_mut().insert(manifest, initialized);
    h.ok(&[h.receive()]);
    h.delivered(h.ata());
}

#[test]
fn a_malformed_acl_mint_config_fails_before_noop_or_redirect() {
    for unfrozen in [false, true] {
        let h = Harness::new(true, false);
        if unfrozen {
            h.ok(&[h.create_ata(), h.thaw()]);
        }
        h.set_permissionless_thaw(false);
        h.redirect();
        h.verify();
        let plan = h.instructions();
        let key = plan[0].accounts[lz_receive_slots().acl[0]].pubkey;
        h.f.context.account_store.borrow_mut().get_mut(&key).unwrap().data = vec![0];
        let payload = h.account(h.payload());
        let ata = h.account(h.ata());
        assert_eq!(h.run(&plan).program_result, failure(OFTError::InvalidAclMintConfig));
        assert_eq!(h.account(h.ata()), ata);
        assert_eq!(h.account(h.payload()), payload);
        assert_eq!(h.token(h.f.fee_deposit).amount, 0);
    }
}

#[test]
fn native_acl_failure_is_not_swallowed_as_redirect() {
    let h = Harness::new(true, false);
    h.redirect();
    h.verify();
    let plan = h.instructions();
    let flag = plan[0].accounts[lz_receive_slots().acl[2]].pubkey;
    // Corrupted runtime fixture: native ACL cannot allocate its transient flag. The interface
    // must propagate that native error, not reinterpret it as a policy decision to redirect.
    h.f.context
        .account_store
        .borrow_mut()
        .insert(flag, Account { data: vec![1], ..Account::new(10_000_000, 0, &Pubkey::default()) });
    let payload = h.account(h.payload());
    let result = h.run(&plan);
    assert!(!result.program_result.is_ok());
    let keys = result.message.as_ref().unwrap().account_keys();
    assert!(result
        .inner_instructions
        .iter()
        .flatten()
        .any(|inner| keys[usize::from(inner.instruction.program_id_index)]
            == host(token_acl_interface::TOKEN_ACL_ID)));
    assert!(h.account(h.ata()).data.is_empty());
    assert_eq!(h.account(h.payload()), payload);
    assert_eq!(h.token(h.f.fee_deposit).amount, 0);
}

/// Anyone can send lamports to the flag address, derived from the token account alone. Token ACL
/// refunds them to the thaw's payer, so the delivery still thaws and the payer collects them.
#[test]
fn a_pre_funded_acl_flag_does_not_block_the_thaw() {
    const FUNDING: u64 = 1_000_000;
    // The payer's net change for the same delivery, with the flag either absent or pre-funded.
    let payer_delta = |pre_fund: bool| {
        let h = Harness::new(true, false);
        h.verify();
        let plan = h.instructions();
        let flag = plan[0].accounts[lz_receive_slots().acl[2]].pubkey;
        if pre_fund {
            h.f.context
                .account_store
                .borrow_mut()
                .insert(flag, Account::new(FUNDING, 0, &Pubkey::default()));
        }
        let before = h.account(h.f.payer).lamports;
        h.ok(&plan);
        h.delivered(h.ata());
        assert_eq!(h.account(flag).lamports, 0);
        i128::from(h.account(h.f.payer).lamports) - i128::from(before)
    };
    assert_eq!(payer_delta(true) - payer_delta(false), i128::from(FUNDING));
}

/// A plan names the gate's extras as its manifest stood at planning time, and never redirects
/// when the gate moves under it; the payload stays retryable.
///
/// - `init_acl` rebound to another policy: the manifest address is unchanged, so a recipient
///   already thawed is delivered (the gate is never consulted) and one that needs a thaw fails
///   until a fresh plan resolves the new manifest. The OFT still screens with its own policy.
/// - Another gate: the stale plan's manifest is no longer the configured gate's, so every recipient
///   fails until the cached gate is synced and the message replanned.
#[test]
fn acl_gate_drift_holds_messages_until_replanned() {
    for rebind in [false, true] {
        for thawed in [false, true] {
            let h = Harness::new(true, false);
            h.redirect();
            if thawed {
                h.ok(&[h.create_ata(), h.thaw()]);
            }
            h.verify();
            let plan = h.instructions();
            if rebind {
                // A second same-mint policy; only the root's DefaultAdmin can rebind the gate.
                let other = Pubkey::new_unique();
                let copy = h.account(h.pubkey_policy);
                h.f.context.account_store.borrow_mut().insert(other, copy);
                h.ok(&[h.init_acl_ix(other)]);
            } else {
                set_external_acl_admin_for_boundary_test(&h);
                h.ok(&[acl::SetGatingProgramBuilder::new()
                    .authority(h.f.admin)
                    .mint_config(h.config())
                    .new_gating_program(Pubkey::new_unique())
                    .instruction()]);
            }
            let payload = h.account(h.payload());
            let result = h.run(&plan).program_result;
            if rebind && thawed {
                assert!(result.is_ok(), "{result:?}");
                h.delivered(h.ata());
            } else {
                assert!(!result.is_ok());
                assert_eq!(h.account(h.payload()), payload, "payload must stay retryable");
                assert_eq!(h.token(h.f.fee_deposit).amount, 0, "never redirected");
                if !rebind {
                    assert_eq!(result, failure(OFTError::InvalidAclThawMetas));
                    h.ok(&[h.sync_acl_gate_ix()]);
                }
                // The replacement gate here is not a program, so only a recipient that needs no
                // thaw can be delivered after replanning.
                if rebind || thawed {
                    h.ok(&h.instructions());
                    h.delivered(h.ata());
                }
            }
        }
    }
}

/// A gate change needs no OFT upgrade: planning refuses the stale cached gate until anyone syncs
/// it, and then names the new gate and its manifest.
#[test]
fn a_gate_change_is_picked_up_by_a_permissionless_sync() {
    let h = Harness::new(true, false);
    h.verify();
    let successor = Pubkey::new_unique();
    set_external_acl_admin_for_boundary_test(&h);
    h.ok(&[acl::SetGatingProgramBuilder::new()
        .authority(h.f.admin)
        .mint_config(h.config())
        .new_gating_program(successor)
        .instruction()]);
    assert_eq!(
        h.plan().program_result,
        mollusk_svm_result::types::ProgramResult::Failure(ProgramError::Custom(
            OFTError::InvalidAclThawMetas.into()
        ))
    );
    h.ok(&[h.sync_acl_gate_ix()]);
    let plan = h.instructions();
    let slots = lz_receive_slots();
    let manifest = host(token_manager_interface::acl::thaw_metas_address(
        &to_program_pubkey(&h.f.token_mint),
        &to_program_pubkey(&successor),
    ));
    assert_eq!(plan[0].accounts[slots.acl[4]].pubkey, successor);
    assert_eq!(plan[0].accounts[slots.acl[1]].pubkey, manifest);
}

/// Token ACL accepts a MintConfig with no gate (`Pubkey::default()`, its "none"), and the synced
/// cache then reads as no MintConfig at all. Planning still names the gate's (unallocated) thaw
/// manifest, so it plans no gate accounts; nothing can thaw permissionlessly without a gate, even
/// with the flag on, so a frozen recipient is redirected, or fails with `CreditBlocked` and stays
/// retryable without an escrow, as for disabled permissionless thaw.
#[test]
fn a_mint_config_without_a_gate_redirects_instead_of_failing_to_plan() {
    for thaw_enabled in [false, true] {
        for redirect in [false, true] {
            let h = Harness::new(true, false);
            h.set_permissionless_thaw(thaw_enabled);
            if redirect {
                h.redirect();
            }
            set_external_acl_admin_for_boundary_test(&h);
            h.ok(&[acl::SetGatingProgramBuilder::new()
                .authority(h.f.admin)
                .mint_config(h.config())
                .new_gating_program(Pubkey::default())
                .instruction()]);
            h.ok(&[h.sync_acl_gate_ix()]);
            h.verify();
            let payload = h.account(h.payload());
            let result = h.run(&h.instructions()).program_result;
            if redirect {
                assert!(result.is_ok(), "{result:?}");
                assert_eq!(h.token(h.f.fee_deposit).amount, 1_000);
                assert_eq!(h.token(h.ata()).state, AccountState::Frozen);
            } else {
                assert_eq!(result, failure(OFTError::CreditBlocked));
                assert_eq!(h.account(h.payload()), payload, "payload must stay retryable");
            }
        }
    }
}

#[test]
fn default_admin_rotation_preserves_an_already_planned_acl_and_hook_delivery() {
    let h = Harness::new(true, true);
    h.verify();
    let plan = h.instructions();
    let manifest = host(token_manager_interface::acl::thaw_metas_address(
        &to_program_pubkey(&h.f.token_mint),
        &token_manager::ID,
    ));
    let keys = [h.f.token_mint, h.config(), manifest];
    let before = keys.map(|key| h.account(key));
    let old = to_program_pubkey(&h.f.admin);
    let new = to_program_pubkey(&h.f.payer);
    h.ok(&[
        ix(
            token_manager::ID,
            token_manager::accounts::StdBeginDefaultAdminTransfer {
                authority: old,
                default_admin: to_program_pubkey(&h.token_manager),
                event_authority: to_program_pubkey(&event(host(token_manager::ID))),
                program: token_manager::ID,
            },
            token_manager::instruction::BeginDefaultAdminTransfer { params: new },
        ),
        ix(
            token_manager::ID,
            token_manager::accounts::StdAcceptDefaultAdminTransfer {
                authority: new,
                payer: old,
                default_admin: to_program_pubkey(&h.token_manager),
                old_admin_role_member: to_program_pubkey(&role(
                    h.token_manager,
                    RoleType::DefaultAdmin,
                    h.f.admin,
                )),
                new_admin_role_member: to_program_pubkey(&role(
                    h.token_manager,
                    RoleType::DefaultAdmin,
                    h.f.payer,
                )),
                system_program: Default::default(),
                event_authority: to_program_pubkey(&event(host(token_manager::ID))),
                program: token_manager::ID,
            },
            token_manager::instruction::AcceptDefaultAdminTransfer {},
        ),
    ]);
    assert_eq!(keys.map(|key| h.account(key)), before);
    let result = h.ok(&plan);
    h.assert_inline_thaw(&result, true);
    h.delivered(h.ata());
}

#[test]
fn acl_hook_composed_receive_uses_live_policy_after_discovery() {
    for blocked in [false, true] {
        let mut h = Harness::new(true, true);
        h.compose = true;
        h.redirect();
        h.verify();
        let plan = h.instructions();
        if blocked {
            h.ok(&[h.membership(h.recipient(), false, true)]);
        }
        let result = h.ok(&plan);
        h.assert_inline_thaw(&result, !blocked);
        h.delivered(if blocked { h.f.fee_deposit } else { h.ata() });
        let p = h.params();
        let tail = codec::msg::compose_msg_with_sender(&p.message).unwrap().unwrap();
        let message =
            codec::compose_msg::encode(p.nonce, p.src_eid, if blocked { 0 } else { 1000 }, tail);
        let key = Pubkey::find_program_address(
            &[
                b"ComposedMessageHash",
                h.f.oft_store.as_ref(),
                h.recipient().as_ref(),
                &p.guid,
                &0u16.to_be_bytes(),
                &solana_keccak_hasher::hash(&message).to_bytes(),
            ],
            &host(endpoint::ID),
        )
        .0;
        assert_eq!(h.account(key).owner, host(endpoint::ID));
        assert!(!h.account(key).data.is_empty());
    }
}
