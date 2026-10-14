//! SBF scenarios for the pubkey-policy program on its own: creation, per-policy RBAC, and the
//! subject-record lifecycle. Consumer binding (ACL gate, hook, OFT) is tested by the consumers.
#[path = "support/mod.rs"]
mod support;

use anchor_lang::error::ErrorCode;
use pubkey_policy::{errors::PubkeyPolicyError, RoleType};
use pubkey_policy_interface::{
    pubkey_policy_address, subject_address, Membership, PubkeyPolicyMode,
};
use solana_pubkey::Pubkey;
use support::*;

#[test]
fn anyone_may_create_a_policy_for_any_mint_and_its_initializer_names_the_admin() {
    let f = Fixture::uninitialized();
    // `keeper` holds no authority over this mint, which need not even exist.
    let mint = Pubkey::new_unique();
    f.ok(&[f.init_ix(mint, f.keeper, f.operator, PubkeyPolicyMode::Whitelist)]);
    let policy = pubkey_policy_address(&mint, &f.keeper).0;
    let state = f.state(&policy);
    assert_eq!(state.mint, mint);
    assert_eq!(state.current_default_admin, f.operator, "no accept step");
    assert_eq!(state.pending_default_admin, Pubkey::default());
    assert_eq!(state.mode, PubkeyPolicyMode::Whitelist);
    // The named admin, not the initializer, administers it: the initializer holds no DefaultAdmin
    // role.
    f.ok(&[f.grant_role_ix(&policy, f.operator, RoleType::Blacklister, f.keeper)]);
    f.fails(
        &[f.grant_role_ix(&policy, f.keeper, RoleType::Whitelister, f.keeper)],
        0,
        ErrorCode::AccountNotInitialized,
    );
    f.fails(
        &[f.set_mode_ix_for(&policy, f.keeper, PubkeyPolicyMode::Open)],
        0,
        ErrorCode::AccountNotInitialized,
    );
    f.ok(&[f.set_mode_ix_for(&policy, f.operator, PubkeyPolicyMode::Open)]);
    assert_eq!(f.state(&policy).mode, PubkeyPolicyMode::Open);

    // Another initializer gets a distinct policy for the same mint; an initializer gets exactly
    // one.
    f.ok(&[f.init_ix(mint, f.admin, f.admin, PubkeyPolicyMode::Open)]);
    assert_ne!(pubkey_policy_address(&mint, &f.admin).0, policy);
    let before = f.account(&policy);
    // System program `AccountAlreadyInUse`: the policy address itself is taken.
    f.fails(&[f.init_ix(mint, f.keeper, f.keeper, PubkeyPolicyMode::Open)], 0, 0u32);
    assert_eq!(f.account(&policy), before);
}

#[test]
fn mode_changes_are_admin_only_and_reject_a_no_op() {
    let f = Fixture::new();
    f.fails(&[f.set_mode_ix(PubkeyPolicyMode::Blacklist)], 0, PubkeyPolicyError::ModeAlreadySet);
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Whitelist)]);
    assert_eq!(f.state(&f.policy).mode, PubkeyPolicyMode::Whitelist);
}

#[test]
fn blacklister_cannot_change_mode_or_substitute_subject_records() {
    let f = Fixture::new();
    let mut ix = f.set_mode_ix(PubkeyPolicyMode::Whitelist);
    for meta in &mut ix.accounts {
        if meta.pubkey == f.admin {
            meta.pubkey = f.operator;
        }
        // The operator's real Blacklister membership, which the DefaultAdmin seeds reject.
        if meta.pubkey == policy_role_member(&f.policy, RoleType::DefaultAdmin, &f.admin) {
            meta.pubkey = policy_role_member(&f.policy, RoleType::Blacklister, &f.operator);
        }
    }
    let before = f.account(&f.policy);
    f.fails(&[ix], 0, ErrorCode::ConstraintSeeds);
    assert_eq!(f.account(&f.policy), before);
    let subject = Pubkey::new_unique();
    let wrong = Pubkey::new_unique();
    let ix = Fixture::with_key(f.block_ix(subject, true), f.record(&subject), f.record(&wrong));
    f.fails(&[ix], 0, ErrorCode::ConstraintSeeds);
    assert!(f.account(&f.record(&wrong)).data.is_empty());
}

#[test]
fn a_rival_policys_admin_cannot_change_this_policy() {
    let f = Fixture::new();
    f.ok(&[f.init_ix(f.mint, f.keeper, f.keeper, PubkeyPolicyMode::Open)]);
    let rival = pubkey_policy_address(&f.mint, &f.keeper).0;
    let before = f.account(&f.policy);
    let mut ix = f.set_mode_ix(PubkeyPolicyMode::Open);
    for meta in &mut ix.accounts {
        if meta.pubkey == f.admin {
            meta.pubkey = f.keeper;
        } else if meta.pubkey == policy_role_member(&f.policy, RoleType::DefaultAdmin, &f.admin) {
            meta.pubkey = policy_role_member(&rival, RoleType::DefaultAdmin, &f.keeper);
        }
    }
    f.fails(&[ix], 0, ErrorCode::ConstraintSeeds);
    assert_eq!(f.account(&f.policy), before);
}

#[test]
fn a_rival_policys_membership_roles_cannot_write_this_policy() {
    let f = Fixture::new();
    f.ok(&[f.init_ix(f.mint, f.keeper, f.keeper, PubkeyPolicyMode::Open)]);
    let rival = pubkey_policy_address(&f.mint, &f.keeper).0;
    f.ok(&[
        f.grant_role_ix(&rival, f.keeper, RoleType::Blacklister, f.keeper),
        f.grant_role_ix(&rival, f.keeper, RoleType::Whitelister, f.keeper),
    ]);
    let subject = Pubkey::new_unique();
    for (ix, role) in [
        (f.blacklist_ix(subject, true), RoleType::Blacklister),
        (f.whitelist_ix(subject, true), RoleType::Whitelister),
    ] {
        let ix = Fixture::with_key(ix, f.operator, f.keeper);
        let ix = Fixture::with_key(
            ix,
            policy_role_member(&f.policy, role, &f.operator),
            policy_role_member(&rival, role, &f.keeper),
        );
        f.fails(&[ix], 0, ErrorCode::ConstraintSeeds);
    }
    assert!(f.account(&f.record(&subject)).data.is_empty());
}

#[test]
fn membership_writes_are_policy_scoped() {
    let f = Fixture::new();
    let subject = Pubkey::new_unique();
    let expected = Pubkey::find_program_address(
        &[b"subject", f.policy.as_ref(), subject.as_ref()],
        &pubkey_policy::ID,
    )
    .0;
    assert_eq!(f.record(&subject), expected);
    f.block(subject, true);
    let before = f.account(&expected);
    assert!(membership(&before.data).unwrap().blacklisted);

    let other_policy = pubkey_policy_address(&f.mint, &Pubkey::new_unique()).0;
    let wrong = subject_address(&other_policy, &subject).0;
    let ix = Fixture::with_key(f.block_ix(subject, false), expected, wrong);
    f.fails(&[ix], 0, ErrorCode::ConstraintSeeds);
    assert!(f.account(&wrong).data.is_empty());
    assert_eq!(f.account(&expected), before);
}

#[test]
fn membership_roles_cannot_cross_write_each_others_bits() {
    let f = Fixture::new();
    let subject = Pubkey::new_unique();
    let blacklister = policy_role_member(&f.policy, RoleType::Blacklister, &f.operator);
    let whitelister = policy_role_member(&f.policy, RoleType::Whitelister, &f.operator);
    let blacklist = Fixture::with_key(f.blacklist_ix(subject, true), blacklister, whitelister);
    f.fails(&[blacklist], 0, ErrorCode::ConstraintSeeds);
    let whitelist = Fixture::with_key(f.whitelist_ix(subject, true), whitelister, blacklister);
    f.fails(&[whitelist], 0, ErrorCode::ConstraintSeeds);
    assert!(f.account(&f.record(&subject)).data.is_empty());
}

/// Matches ERC20Plus `AllowlistStateIdempotent` and `set_rate_limit_address_exemption`: a write
/// that changes nothing is rejected, so it can neither emit a false event nor allocate a record.
#[test]
fn membership_writes_that_change_nothing_are_rejected() {
    let f = Fixture::new();
    let subject = Pubkey::new_unique();

    // No record yet: clearing a bit that was never set asserts nothing. Rejecting it is what
    // stops `init_if_needed` committing an all-false record the enumeration would then report.
    f.fails(&[f.block_ix(subject, false)], 0, PubkeyPolicyError::MembershipStateIdempotent);
    assert!(f.account(&f.record(&subject)).data.is_empty());
    f.fails(&[f.whitelist_ix(subject, false)], 0, PubkeyPolicyError::MembershipStateIdempotent);
    assert!(f.account(&f.record(&subject)).data.is_empty());

    // Redundant write over an existing record is rejected on the same comparison, per bit.
    f.block(subject, true);
    f.fails(&[f.block_ix(subject, true)], 0, PubkeyPolicyError::MembershipStateIdempotent);
    f.fails(&[f.whitelist_ix(subject, false)], 0, PubkeyPolicyError::MembershipStateIdempotent);
    assert_eq!(
        membership(&f.account(&f.record(&subject)).data).unwrap(),
        Membership { blacklisted: true, whitelisted: false }
    );
    f.ok(&[f.whitelist_ix(subject, true)]);
    f.fails(&[f.whitelist_ix(subject, true)], 0, PubkeyPolicyError::MembershipStateIdempotent);
}

/// Once created a record persists: clearing every bit leaves an all-false record at the same
/// address, still policy-program-owned, which readers treat exactly like an absent one.
#[test]
fn clearing_every_bit_keeps_the_record() {
    let f = Fixture::new();
    let subject = Pubkey::new_unique();
    f.ok(&[f.block_ix(subject, true), f.whitelist_ix(subject, true)]);
    let created = f.account(&f.record(&subject));
    f.ok(&[f.block_ix(subject, false), f.whitelist_ix(subject, false)]);
    let cleared = f.account(&f.record(&subject));
    assert_eq!(cleared.owner, pubkey_policy::ID);
    assert_eq!((cleared.data.len(), cleared.lamports), (created.data.len(), created.lamports));
    assert_eq!(membership(&cleared.data).unwrap(), Membership::default());
    // A no-op write over it is still rejected, and it can be set again in place.
    f.fails(&[f.block_ix(subject, false)], 0, PubkeyPolicyError::MembershipStateIdempotent);
    f.block(subject, true);
    assert!(membership(&f.account(&f.record(&subject)).data).unwrap().blacklisted);
}

#[test]
fn admin_transfer_is_two_step_and_revoking_a_role_disables_it() {
    let f = Fixture::new();
    f.ok(&[f.begin_admin_transfer_ix(f.admin, f.keeper)]);
    // Pending only: the old admin still governs, the nominee does not yet.
    f.fails(
        &[f.set_mode_ix_for(&f.policy, f.keeper, PubkeyPolicyMode::Open)],
        0,
        ErrorCode::AccountNotInitialized,
    );
    f.ok(&[f.set_mode_ix(PubkeyPolicyMode::Whitelist)]);
    f.ok(&[f.accept_admin_transfer_ix(f.admin, f.keeper)]);
    assert_eq!(f.state(&f.policy).current_default_admin, f.keeper);
    f.fails(&[f.set_mode_ix(PubkeyPolicyMode::Open)], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.set_mode_ix_for(&f.policy, f.keeper, PubkeyPolicyMode::Open)]);

    // Operational roles survive the transfer until the new admin revokes them.
    let subject = Pubkey::new_unique();
    f.block(subject, true);
    f.ok(&[f.revoke_role_ix(f.keeper, RoleType::Blacklister, f.operator)]);
    let before = f.account(&f.record(&subject));
    f.fails(&[f.block_ix(subject, false)], 0, ErrorCode::AccountNotInitialized);
    assert_eq!(f.account(&f.record(&subject)), before);
}

#[test]
fn writes_emit_initialized_membership_and_mode_events() {
    let f = Fixture::uninitialized();
    let result = f.run(&[f.init_policy_ix(f.admin, PubkeyPolicyMode::Blacklist)]);
    let Ok([init]) =
        <[_; 1]>::try_from(Fixture::events::<pubkey_policy::PubkeyPolicyInitialized>(&result))
    else {
        panic!("one PubkeyPolicyInitialized");
    };
    assert_eq!(
        (init.pubkey_policy, init.mint, init.initializer, init.admin),
        (f.policy, f.mint, f.admin, f.admin)
    );
    assert_eq!(init.mode, PubkeyPolicyMode::Blacklist);

    f.ok(&[f.grant_role_ix(&f.policy, f.admin, RoleType::Blacklister, f.operator)]);
    let subject = Pubkey::new_unique();
    let result = f.run(&[f.block_ix(subject, true)]);
    let Ok([changed]) =
        <[_; 1]>::try_from(Fixture::events::<pubkey_policy::MembershipChanged>(&result))
    else {
        panic!("one MembershipChanged");
    };
    assert_eq!((changed.pubkey_policy, changed.mint, changed.subject), (f.policy, f.mint, subject));
    assert_eq!(changed.membership, Membership { blacklisted: true, whitelisted: false });
    assert_eq!(changed.authority, f.operator);

    let result = f.run(&[f.set_mode_ix(PubkeyPolicyMode::Whitelist)]);
    let Ok([mode]) = <[_; 1]>::try_from(Fixture::events::<pubkey_policy::ModeChanged>(&result))
    else {
        panic!("one ModeChanged");
    };
    assert_eq!(
        (mode.pubkey_policy, mode.mode, mode.authority),
        (f.policy, PubkeyPolicyMode::Whitelist, f.admin)
    );
}

/// SDKs read which account layouts and IDL a deployment speaks from the build itself.
#[test]
fn get_version_reports_this_builds_versions() {
    use anchor_lang::{AnchorDeserialize, InstructionData, ToAccountMetas};
    let f = Fixture::new();
    let result = f.context.process_instruction(&solana_instruction::Instruction {
        program_id: pubkey_policy::ID,
        accounts: pubkey_policy::accounts::GetVersion { program: pubkey_policy::ID }
            .to_account_metas(None),
        data: pubkey_policy::instruction::GetVersion {}.data(),
    });
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    assert_eq!(
        pubkey_policy_interface::ProgramVersion::try_from_slice(&result.return_data).unwrap(),
        pubkey_policy_interface::PUBKEY_POLICY_VERSION
    );
}
