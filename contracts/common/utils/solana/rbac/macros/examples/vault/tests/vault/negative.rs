use crate::helpers::*;
use anchor_lang::AccountDeserialize;
use mollusk_svm::result::types::ProgramResult;
use rbac::RbacError;
use solana_account::Account;
use solana_program_error::ProgramError;
use vault::state::{VaultRoleType, VaultState};

// ── initialize ────────────────────────────────────────────────────────────────

/// double-init: vault state account already exists → `init` constraint rejects.
#[test]
fn test_initialize_fails_on_double_init() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, _) = role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &initialize_ix(&payer, &vault_key, &admin_role_key),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            sys_keyed(),
            (admin_role_key, Account::default()),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    // System program returns AccountAlreadyInUse (Custom(0)) when init tries
    // to create_account on an account that already exists.
    assert_eq!(
        result.program_result,
        ProgramResult::Failure(ProgramError::Custom(0)),
        "double-init should fail with system AccountAlreadyInUse"
    );
}

// ── deposit ───────────────────────────────────────────────────────────────────

/// deposit rejected: caller lacks Depositor role → balance must not change.
#[test]
fn test_deposit_rejected_when_caller_lacks_depositor_role() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (role_key, _) = role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    // Provide an empty account at role_key — constraint fails, instruction must not succeed.
    let result = mollusk.process_instruction(
        &deposit_ix(&user, &vault_key, &role_key, 100),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (role_key, Account::default()),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "deposit should fail with AccountNotInitialized when caller has no Depositor role"
    );
    let state_data = &result.get_account(&vault_key).unwrap().data;
    let state = VaultState::try_deserialize(&mut state_data.as_ref()).unwrap();
    assert_eq!(state.balance, 0, "balance must not change on failed deposit");
}

/// deposit rejected: caller has a role but the WRONG type → ConstraintSeeds.
///
/// The `#[only_role]` constraint derives the expected PDA from `[Depositor_seed, authority]`.
/// If the caller holds DefaultAdmin (not Depositor) and passes their DefaultAdmin PDA in the
/// role_member slot, the key mismatches the derived Depositor PDA → ConstraintSeeds.
#[test]
fn test_deposit_fails_when_caller_has_wrong_role_type() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    // user holds DefaultAdmin; we pass this PDA where a Depositor PDA is expected.
    let (user_admin_role_key, user_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &deposit_ix(&user, &vault_key, &user_admin_role_key, 100),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            // Initialized DefaultAdmin RoleMember at the DefaultAdmin PDA address.
            // Anchor derives expected = Depositor PDA, but gets DefaultAdmin PDA →
            // ConstraintSeeds.
            (
                user_admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &user, user_admin_role_bump),
            ),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::ConstraintSeeds)),
        "deposit should fail with ConstraintSeeds when caller has DefaultAdmin but not Depositor"
    );
}

// ── grant_role ────────────────────────────────────────────────────────────────

/// non-admin tries to grant a role: empty admin-role PDA → AccountNotInitialized.
#[test]
fn test_grant_role_fails_when_caller_lacks_admin_role() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    // user has no DefaultAdmin role — its PDA is empty
    let (fake_admin_role_key, _) = role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);
    let (depositor_role_key, _) = role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    let result = mollusk.process_instruction(
        &grant_role_ix(
            &user,
            &user,
            &vault_key,
            &fake_admin_role_key,
            &depositor_role_key,
            VaultRoleType::Depositor,
            &user,
        ),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (fake_admin_role_key, Account::default()), // non-existent → AccountNotInitialized
            (depositor_role_key, Account::default()),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "grant_role should fail with AccountNotInitialized when admin role PDA is empty"
    );
}

/// grant_role fails when caller has a role but the WRONG type → ConstraintSeeds.
///
/// The `role_admin_member` seeds are derived from `[role_admin_seed, authority]`, where
/// `role_admin(Depositor) = DefaultAdmin`. If the caller passes their Depositor PDA in
/// that slot, the key mismatches the expected DefaultAdmin PDA → ConstraintSeeds.
#[test]
fn test_grant_role_fails_when_caller_has_wrong_role_type() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let other = other_key();
    let (vault_key, vault_bump) = vault_pda();
    // user holds Depositor; they pass this PDA where the DefaultAdmin PDA is expected.
    let (user_depositor_key, user_depositor_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);
    let (other_depositor_key, _) = role_member_pda(&vault_key, VaultRoleType::Depositor, &other);

    let result = mollusk.process_instruction(
        &grant_role_ix(
            &user,
            &user,
            &vault_key,
            &user_depositor_key, // wrong role type in admin slot
            &other_depositor_key,
            VaultRoleType::Depositor,
            &other,
        ),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            // user's Depositor PDA is valid, but Anchor expects user's DefaultAdmin PDA
            // (because role_admin(Depositor) = DefaultAdmin) → ConstraintSeeds.
            (
                user_depositor_key,
                role_member_account(VaultRoleType::Depositor, &user, user_depositor_bump),
            ),
            (other_depositor_key, Account::default()),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::ConstraintSeeds)),
        "grant_role should fail with ConstraintSeeds when caller has Depositor but not DefaultAdmin"
    );
}

/// duplicate grant: role-member PDA already exists → `init` constraint rejects.
#[test]
fn test_grant_role_fails_on_duplicate() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    let (depositor_role_key, depositor_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    // Provide an already-initialised role_member account → `init` must fail.
    let result = mollusk.process_instruction(
        &grant_role_ix(
            &payer,
            &payer,
            &vault_key,
            &admin_role_key,
            &depositor_role_key,
            VaultRoleType::Depositor,
            &user,
        ),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, admin_role_bump),
            ),
            (
                depositor_role_key,
                role_member_account(VaultRoleType::Depositor, &user, depositor_role_bump),
            ),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    // System program returns AccountAlreadyInUse (Custom(0)) when init tries
    // to create_account on an account that already exists.
    assert_eq!(
        result.program_result,
        ProgramResult::Failure(ProgramError::Custom(0)),
        "duplicate grant should fail with system AccountAlreadyInUse"
    );
}

/// direct DefaultAdmin grant bypassing the 2-step transfer → DefaultAdminNotGrantable.
#[test]
fn test_grant_role_fails_when_granting_default_admin_directly() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    let (new_admin_role_key, _) = role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &grant_role_ix(
            &payer,
            &payer,
            &vault_key,
            &admin_role_key,
            &new_admin_role_key,
            VaultRoleType::DefaultAdmin, // must fail: DefaultAdminNotGrantable
            &user,
        ),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, admin_role_bump),
            ),
            (new_admin_role_key, Account::default()),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(RbacError::DefaultAdminNotGrantable)),
        "grant_role should fail with DefaultAdminNotGrantable"
    );
}

// ── revoke_role ────────────────────────────────────────────────────────────────

/// non-admin tries to revoke a role: empty admin-role PDA → AccountNotInitialized.
#[test]
fn test_revoke_role_fails_when_caller_lacks_admin_role() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    // user has no DefaultAdmin role — its PDA is empty
    let (fake_admin_role_key, _) = role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);
    let (depositor_role_key, depositor_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    let result = mollusk.process_instruction(
        &revoke_role_ix(
            &user,
            &user,
            &vault_key,
            &fake_admin_role_key, // non-existent → AccountNotInitialized
            &depositor_role_key,
            VaultRoleType::Depositor,
            &user,
        ),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (fake_admin_role_key, Account::default()),
            (
                depositor_role_key,
                role_member_account(VaultRoleType::Depositor, &user, depositor_role_bump),
            ),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "revoke_role should fail with AccountNotInitialized when admin role PDA is empty"
    );
}

/// revoke_role fails when caller has a role but the WRONG type → ConstraintSeeds.
///
/// Same seed derivation logic as grant_role: `role_admin(Depositor) = DefaultAdmin`.
/// Caller passes their Depositor PDA where the DefaultAdmin PDA is expected → ConstraintSeeds.
#[test]
fn test_revoke_role_fails_when_caller_has_wrong_role_type() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let other = other_key();
    let (vault_key, vault_bump) = vault_pda();
    // user holds Depositor; they pass this PDA where the DefaultAdmin PDA is expected.
    let (user_depositor_key, user_depositor_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);
    let (other_depositor_key, other_depositor_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &other);

    let result = mollusk.process_instruction(
        &revoke_role_ix(
            &user,
            &user,
            &vault_key,
            &user_depositor_key, // wrong role type in admin slot
            &other_depositor_key,
            VaultRoleType::Depositor,
            &other,
        ),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                user_depositor_key,
                role_member_account(VaultRoleType::Depositor, &user, user_depositor_bump),
            ),
            (
                other_depositor_key,
                role_member_account(VaultRoleType::Depositor, &other, other_depositor_bump),
            ),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::ConstraintSeeds)),
        "revoke_role should fail with ConstraintSeeds when caller has Depositor but not DefaultAdmin"
    );
}

/// revoke a role that was never granted: empty role-member PDA → AccountNotInitialized.
#[test]
fn test_revoke_role_fails_when_role_member_does_not_exist() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    let (depositor_role_key, _) = role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    let result = mollusk.process_instruction(
        &revoke_role_ix(
            &payer,
            &payer,
            &vault_key,
            &admin_role_key,
            &depositor_role_key, // non-existent → AccountNotInitialized
            VaultRoleType::Depositor,
            &user,
        ),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, admin_role_bump),
            ),
            (depositor_role_key, Account::default()),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "revoke_role should fail with AccountNotInitialized when role member does not exist"
    );
}

/// revoke DefaultAdmin directly → DefaultAdminNotRevocable.
///
/// Must use the two-step transfer flow, not revoke_role.
///
/// Note: `role_member` is `Account<'info, RoleMember>` with a `bump` constraint, so Anchor
/// deserializes it *before* the handler runs. The target PDA must be initialized; the
/// `DefaultAdminNotRevocable` check fires inside the handler after account validation passes.
#[test]
fn test_revoke_role_fails_when_revoking_default_admin_directly() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    // Provide user's DefaultAdmin PDA as an initialized account so the Anchor
    // `bump = role_member.bump` constraint passes; the handler then rejects with
    // DefaultAdminNotRevocable.
    let (user_admin_role_key, user_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &revoke_role_ix(
            &payer,
            &payer,
            &vault_key,
            &admin_role_key,
            &user_admin_role_key,
            VaultRoleType::DefaultAdmin, // must fail: DefaultAdminNotRevocable
            &user,
        ),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, admin_role_bump),
            ),
            (
                user_admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &user, user_admin_role_bump),
            ),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(RbacError::DefaultAdminNotRevocable)),
        "revoke_role should fail with DefaultAdminNotRevocable"
    );
}

// ── renounce_role ─────────────────────────────────────────────────────────────

/// impostor tries to renounce someone else's role:
/// authority ≠ role-member seed member → ConstraintSeeds.
#[test]
fn test_renounce_role_fails_when_renouncing_someone_elses_role() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    // PDA belongs to `user`, but authority is `payer` (impostor)
    let (depositor_role_key, depositor_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    let result = mollusk.process_instruction(
        &renounce_role_ix(
            &payer,
            &payer,
            &vault_key,
            &depositor_role_key, // PDA for user, not payer → ConstraintSeeds
            VaultRoleType::Depositor,
        ),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                depositor_role_key,
                role_member_account(VaultRoleType::Depositor, &user, depositor_role_bump),
            ),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::ConstraintSeeds)),
        "renounce_role should fail with ConstraintSeeds when authority != role-member PDA seeds"
    );
}

/// renounce a role that was never granted: empty role-member PDA → AccountNotInitialized.
#[test]
fn test_renounce_role_fails_when_role_does_not_exist() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (depositor_role_key, _) = role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    let result = mollusk.process_instruction(
        &renounce_role_ix(
            &user,
            &user,
            &vault_key,
            &depositor_role_key, // non-existent → AccountNotInitialized
            VaultRoleType::Depositor,
        ),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (depositor_role_key, Account::default()),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "renounce_role should fail with AccountNotInitialized when role member does not exist"
    );
}

/// renounce DefaultAdmin → DefaultAdminNotRenounceable.
///
/// There must always be exactly one DefaultAdmin; renouncing it is forbidden.
#[test]
fn test_renounce_role_fails_when_renouncing_default_admin() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &renounce_role_ix(
            &payer,
            &payer,
            &vault_key,
            &admin_role_key,
            VaultRoleType::DefaultAdmin, // must fail: DefaultAdminNotRenounceable
        ),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, admin_role_bump),
            ),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(RbacError::DefaultAdminNotRenounceable)),
        "renounce_role should fail with DefaultAdminNotRenounceable"
    );
}

// ── begin_default_admin_transfer ──────────────────────────────────────────────

/// non-admin calls begin_default_admin_transfer → Unauthorized.
#[test]
fn test_begin_default_admin_transfer_fails_for_non_admin() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();

    let result = mollusk.process_instruction(
        &begin_transfer_ix(
            &user, // non-admin signer; check fails before business logic
            &vault_key,
            &other_key(),
        ),
        &[
            (user, user_account()),
            // current_default_admin = payer, but authority = user → Unauthorized
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(RbacError::Unauthorized)),
        "begin_default_admin_transfer should fail with Unauthorized"
    );
}

/// self-transfer: new_admin == current_admin → NewAdminIsSameAsCurrent.
#[test]
fn test_begin_default_admin_transfer_fails_for_self_transfer() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (vault_key, vault_bump) = vault_pda();

    let result = mollusk.process_instruction(
        &begin_transfer_ix(
            &payer, &vault_key,
            &payer, // new_admin == current_admin → NewAdminIsSameAsCurrent
        ),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(RbacError::NewAdminIsSameAsCurrent)),
        "begin_default_admin_transfer should fail with NewAdminIsSameAsCurrent"
    );
}

// ── accept_default_admin_transfer ─────────────────────────────────────────────

/// accept_default_admin_transfer fails when the new admin already holds DefaultAdmin →
/// AccountAlreadyInUse.
///
/// The `new_admin_role_member` uses `init`, so if the account already exists (e.g. the pending
/// admin already has a DefaultAdmin PDA from a previous transfer), the system program rejects
/// create_account with AccountAlreadyInUse (Custom(0)).
#[test]
fn test_accept_default_admin_transfer_fails_when_new_admin_already_has_role() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (old_admin_role_key, old_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    // user already holds DefaultAdmin (e.g. inherited from a prior transfer cycle).
    let (new_admin_role_key, new_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &accept_transfer_ix(&user, &user, &vault_key, &old_admin_role_key, &new_admin_role_key),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &user)),
            (
                old_admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, old_admin_role_bump),
            ),
            // new_admin_role_member already exists → `init` constraint fails.
            (
                new_admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &user, new_admin_role_bump),
            ),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(ProgramError::Custom(0)),
        "accept_default_admin_transfer should fail with AccountAlreadyInUse when new admin already has DefaultAdmin role"
    );
}

/// wrong signer tries to accept: authority ≠ pending_admin → CallerNotPendingAdmin.
///
/// Setup: current = payer, pending = user.
/// Attacker (other_key) tries to accept and claim the admin role.
#[test]
fn test_accept_default_admin_transfer_fails_for_wrong_signer() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let other = other_key();
    let (vault_key, vault_bump) = vault_pda();
    let (old_admin_role_key, old_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    // new_admin_role_key is for the attacker (other), not the pending admin (user)
    let (new_admin_role_key, _) = role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &other);

    let result = mollusk.process_instruction(
        &accept_transfer_ix(
            &other, // wrong signer
            &other,
            &vault_key,
            &old_admin_role_key,
            &new_admin_role_key,
        ),
        &[
            (other, other_account()),
            // pending = user, but authority = other → CallerNotPendingAdmin
            (vault_key, vault_account(0, vault_bump, &payer, &user)),
            (
                old_admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, old_admin_role_bump),
            ),
            (new_admin_role_key, Account::default()),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(RbacError::CallerNotPendingAdmin)),
        "accept_default_admin_transfer should fail with CallerNotPendingAdmin"
    );
}

/// accept when no transfer is in progress: pending_admin = zero → CallerNotPendingAdmin.
#[test]
fn test_accept_default_admin_transfer_fails_when_no_transfer_in_progress() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (old_admin_role_key, old_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    let (new_admin_role_key, _) = role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &accept_transfer_ix(&user, &user, &vault_key, &old_admin_role_key, &new_admin_role_key),
        &[
            (user, user_account()),
            // pending = no_pending_admin() (no transfer was ever started)
            // user != zero → CallerNotPendingAdmin
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                old_admin_role_key,
                role_member_account(VaultRoleType::DefaultAdmin, &payer, old_admin_role_bump),
            ),
            (new_admin_role_key, Account::default()),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(RbacError::CallerNotPendingAdmin)),
        "accept_default_admin_transfer should fail with CallerNotPendingAdmin"
    );
}
