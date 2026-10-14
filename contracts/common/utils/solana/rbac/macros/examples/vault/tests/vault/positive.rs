use crate::helpers::*;
use anchor_lang::AnchorDeserialize;
use mollusk_svm::result::Check;
use rbac::{
    events::{DefaultAdminTransferStarted, RoleGranted, RoleRevoked},
    types::DefaultAdminInfo,
};
use solana_account::Account;
use vault::state::VaultRoleType;

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_creates_vault_state_and_admin_role_member() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);

    // Initialize account order (after #[init_default_admin] injection + #[event_cpi]):
    //   0: payer, 1: state, 2: system_program, 3: admin_role_member,
    //   4: event_authority, 5: program
    let result = mollusk.process_and_validate_instruction(
        &initialize_ix(&payer, &vault_key, &admin_role_key),
        &[
            (payer, payer_account()),
            (vault_key, Account::default()),
            sys_keyed(),
            (admin_role_key, Account::default()),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
        &[
            Check::success(),
            // inner[0]: system program create_account (init `state`/vault PDA)
            // inner[1]: system program create_account (init admin_role_member PDA)
            // inner[2]: __event_cpi (RoleGranted — DefaultAdmin granted to payer by
            // setup_default_admin!)
            Check::inner_instruction_count(3),
            Check::account(&vault_key)
                .data(&vault_data(0, vault_bump, &payer, &no_pending_admin()))
                .build(),
            Check::account(&admin_role_key)
                .data(&role_member_data(VaultRoleType::DefaultAdmin, &payer, admin_role_bump))
                .build(),
        ],
    );

    assert_event(
        &result.inner_instructions[2].instruction.data,
        RoleGranted {
            state: to_program_pubkey(&vault_key),
            role: VaultRoleType::DefaultAdmin as u8,
            account: to_program_pubkey(&payer),
            sender: to_program_pubkey(&payer),
        },
    );
}

// ── get_default_admin ─────────────────────────────────────────────────────────

#[test]
fn test_get_default_admin_returns_current_and_pending_admin() {
    use anchor_lang::Discriminator;
    use solana_instruction::{AccountMeta, Instruction};
    use vault::instruction as ix;

    let mollusk = mollusk();
    let payer = payer_key();
    let (vault_key, vault_bump) = vault_pda();

    // get_default_admin is a simple view: single readonly account, no params.
    let get_ix = Instruction {
        program_id: program_id(),
        accounts: vec![AccountMeta::new_readonly(vault_key, false)],
        data: ix::GetDefaultAdmin::DISCRIMINATOR.to_vec(),
    };

    let result = mollusk.process_and_validate_instruction(
        &get_ix,
        &[(vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin()))],
        &[Check::success()],
    );

    let info = DefaultAdminInfo::try_from_slice(&result.return_data)
        .expect("failed to decode DefaultAdminInfo");
    assert_eq!(info.current.as_ref(), payer.as_ref());
    assert_eq!(info.pending.as_ref(), no_pending_admin().as_ref());
}

// ── deposit ───────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_with_depositor_role_increments_balance() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (role_key, role_bump) = role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    // Deposit account order (after #[only_role] injection):
    //   0: authority, 1: state, 2: role_member
    mollusk.process_and_validate_instruction(
        &deposit_ix(&user, &vault_key, &role_key, 100),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (role_key, role_member_account(VaultRoleType::Depositor, &user, role_bump)),
        ],
        &[
            Check::success(),
            Check::account(&vault_key)
                .data(&vault_data(100, vault_bump, &payer, &no_pending_admin()))
                .build(),
        ],
    );
}

// ── grant_role ────────────────────────────────────────────────────────────────

#[test]
fn test_grant_role_creates_depositor_role_member() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    let (depositor_role_key, depositor_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    // StdGrantRole (+ #[event_cpi]):
    //   0: authority, 1: payer, 2: default_admin, 3: role_admin_member,
    //   4: role_member, 5: system_program, 6: event_authority, 7: program
    let result = mollusk.process_and_validate_instruction(
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
            (depositor_role_key, Account::default()),
            sys_keyed(),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
        &[
            Check::success(),
            // inner[0]: system program create_account (init role_member)
            // inner[1]: __event_cpi (RoleGranted)
            Check::inner_instruction_count(2),
            Check::account(&depositor_role_key)
                .data(&role_member_data(VaultRoleType::Depositor, &user, depositor_role_bump))
                .build(),
        ],
    );

    assert_event(
        &result.inner_instructions[1].instruction.data,
        RoleGranted {
            state: to_program_pubkey(&vault_key),
            role: VaultRoleType::Depositor as u8,
            account: to_program_pubkey(&user),
            sender: to_program_pubkey(&payer),
        },
    );
}

// ── revoke_role ───────────────────────────────────────────────────────────────

#[test]
fn test_revoke_role_closes_depositor_role_member() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    let (depositor_role_key, depositor_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    // StdRevokeRole (+ #[event_cpi]):
    //   0: authority, 1: receiver, 2: default_admin, 3: role_admin_member,
    //   4: role_member, 5: event_authority, 6: program
    let result = mollusk.process_and_validate_instruction(
        &revoke_role_ix(
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
            event_authority_keyed(),
            vault_program_keyed(),
        ],
        &[
            Check::success(),
            Check::inner_instruction_count(1),
            // role_member closed: lamports transferred to receiver (payer)
            Check::account(&depositor_role_key).lamports(0).build(),
            // payer (receiver) gained the closed account's 1_000_000 lamports
            Check::account(&payer).lamports(11_000_000).build(),
        ],
    );

    assert_event(
        &result.inner_instructions[0].instruction.data,
        RoleRevoked {
            state: to_program_pubkey(&vault_key),
            role: VaultRoleType::Depositor as u8,
            account: to_program_pubkey(&user),
            sender: to_program_pubkey(&payer),
        },
    );
}

// ── renounce_role ─────────────────────────────────────────────────────────────

#[test]
fn test_renounce_role_closes_own_depositor_role_member() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (depositor_role_key, depositor_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::Depositor, &user);

    // StdRenounceRole (+ #[event_cpi]):
    //   0: authority, 1: receiver, 2: default_admin, 3: role_member,
    //   4: event_authority, 5: program
    let result = mollusk.process_and_validate_instruction(
        &renounce_role_ix(&user, &user, &vault_key, &depositor_role_key, VaultRoleType::Depositor),
        &[
            (user, user_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            (
                depositor_role_key,
                role_member_account(VaultRoleType::Depositor, &user, depositor_role_bump),
            ),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
        &[
            Check::success(),
            Check::inner_instruction_count(1),
            // role_member closed: lamports transferred to receiver (user)
            Check::account(&depositor_role_key).lamports(0).build(),
            // user (receiver) gained the closed account's 1_000_000 lamports
            Check::account(&user).lamports(11_000_000).build(),
        ],
    );

    // sender == authority == user for renounce
    assert_event(
        &result.inner_instructions[0].instruction.data,
        RoleRevoked {
            state: to_program_pubkey(&vault_key),
            role: VaultRoleType::Depositor as u8,
            account: to_program_pubkey(&user),
            sender: to_program_pubkey(&user),
        },
    );
}

// ── begin_default_admin_transfer ──────────────────────────────────────────────

#[test]
fn test_begin_default_admin_transfer_sets_pending_admin() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();

    // StdBeginDefaultAdminTransfer (+ #[event_cpi]):
    //   0: authority, 1: default_admin, 2: event_authority, 3: program
    let result = mollusk.process_and_validate_instruction(
        &begin_transfer_ix(&payer, &vault_key, &user),
        &[
            (payer, payer_account()),
            (vault_key, vault_account(0, vault_bump, &payer, &no_pending_admin())),
            event_authority_keyed(),
            vault_program_keyed(),
        ],
        &[
            Check::success(),
            Check::inner_instruction_count(1),
            // pending_default_admin updated to user
            Check::account(&vault_key)
                .data(&vault_data(0, vault_bump, &payer, &user))
                .build(),
        ],
    );

    assert_event(
        &result.inner_instructions[0].instruction.data,
        DefaultAdminTransferStarted {
            state: to_program_pubkey(&vault_key),
            new_admin: to_program_pubkey(&user),
        },
    );
}

// ── accept_default_admin_transfer ─────────────────────────────────────────────

#[test]
fn test_accept_default_admin_transfer_swaps_admin() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (vault_key, vault_bump) = vault_pda();
    let (old_admin_role_key, old_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &payer);
    let (new_admin_role_key, new_admin_role_bump) =
        role_member_pda(&vault_key, VaultRoleType::DefaultAdmin, &user);

    // StdAcceptDefaultAdminTransfer (+ #[event_cpi]):
    //   0: authority, 1: payer, 2: default_admin, 3: old_admin_role_member,
    //   4: new_admin_role_member, 5: system_program, 6: event_authority, 7: program
    //
    // Pre-condition: pending_default_admin == user (set by begin_default_admin_transfer)
    let result = mollusk.process_and_validate_instruction(
        &accept_transfer_ix(&user, &user, &vault_key, &old_admin_role_key, &new_admin_role_key),
        &[
            (user, user_account()),
            // pending_default_admin = user (set by a prior begin_default_admin_transfer)
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
        &[
            Check::success(),
            // inner[0]: system program create_account (init new_admin_role_member)
            // inner[1]: __event_cpi (RoleRevoked — old admin)
            // inner[2]: __event_cpi (RoleGranted — new admin)
            Check::inner_instruction_count(3),
            // State: current_default_admin = user, pending cleared
            Check::account(&vault_key)
                .data(&vault_data(0, vault_bump, &user, &no_pending_admin()))
                .build(),
            // old DefaultAdmin RoleMember closed: lamports → user (payer)
            Check::account(&old_admin_role_key).lamports(0).build(),
            // new DefaultAdmin RoleMember created for user
            Check::account(&new_admin_role_key)
                .data(&role_member_data(VaultRoleType::DefaultAdmin, &user, new_admin_role_bump))
                .build(),
        ],
    );

    // inner_instructions[1]: RoleRevoked (old admin loses DefaultAdmin)
    assert_event(
        &result.inner_instructions[1].instruction.data,
        RoleRevoked {
            state: to_program_pubkey(&vault_key),
            role: VaultRoleType::DefaultAdmin as u8,
            account: to_program_pubkey(&payer),
            sender: to_program_pubkey(&user),
        },
    );

    // inner_instructions[2]: RoleGranted (new admin gains DefaultAdmin)
    assert_event(
        &result.inner_instructions[2].instruction.data,
        RoleGranted {
            state: to_program_pubkey(&vault_key),
            role: VaultRoleType::DefaultAdmin as u8,
            account: to_program_pubkey(&user),
            sender: to_program_pubkey(&user),
        },
    );
}
