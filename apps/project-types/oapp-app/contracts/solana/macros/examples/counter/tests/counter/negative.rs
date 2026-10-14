use crate::helpers::*;
use counter::state::CounterRoleType;
use mollusk_svm::result::types::ProgramResult;
use oapp::{types::SetEnforcedOptionsParams, OAppError};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

/// `SystemError::AccountAlreadyInUse`: Anchor's `init` allocates through the system program, which
/// refuses an address that already holds data.
const SYSTEM_ACCOUNT_ALREADY_IN_USE: u32 = 0;

// ── initialize ────────────────────────────────────────────────────────────────

/// double-init: counter state account already exists → `init` constraint rejects.
#[test]
fn test_initialize_fails_on_double_init() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let (admin_role_key, _) = role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);
    let (oapp_info_key, _) = oapp_info_pda();

    let result = mollusk.process_instruction(
        &initialize_ix(&payer, &counter_key, &oapp_info_key, &admin_role_key),
        &[
            (payer, payer_account()),
            // Supply a pre-existing state account → `init` must fail.
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (oapp_info_key, Account::default()),
            sys_keyed(),
            (admin_role_key, Account::default()),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(ProgramError::Custom(SYSTEM_ACCOUNT_ALREADY_IN_USE)),
        "double-init should fail with system AccountAlreadyInUse"
    );
}

// ── set_peer ──────────────────────────────────────────────────────────────────

/// non-admin tries to set peer: their DefaultAdmin PDA is empty → AccountNotInitialized.
#[test]
fn test_set_peer_fails_for_non_admin() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let (peer_key, _) = peer_pda(&counter_key, eid);
    // user has no DefaultAdmin role — its PDA is empty.
    let (user_role_key, _) = role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &set_peer_ix(&user, &user, &counter_key, &peer_key, &user_role_key, eid, [0xCC; 32]),
        &[
            (user, user_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (peer_key, Account::default()),
            sys_keyed(),
            (user_role_key, Account::default()), // non-existent → AccountNotInitialized
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "set_peer should fail with AccountNotInitialized when caller has no DefaultAdmin role"
    );
}

// ── init_enforced_options ─────────────────────────────────────────────────────

/// non-admin tries to init enforced options → AccountNotInitialized.
#[test]
fn test_init_enforced_options_fails_for_non_admin() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, _) = enforced_options_pda(&counter_key, eid, msg_type);
    let (user_role_key, _) = role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &init_enforced_options_ix(
            &user,
            &user,
            &counter_key,
            &eo_key,
            &user_role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: valid_type3_options() },
        ),
        &[
            (user, user_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, Account::default()),
            sys_keyed(),
            (user_role_key, Account::default()), // non-existent → AccountNotInitialized
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "init_enforced_options should fail with AccountNotInitialized for non-admin"
    );
}

/// options with wrong type (type 1 instead of 3) → `InvalidOptions`.
#[test]
fn test_init_enforced_options_fails_with_wrong_options_type() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, _) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &init_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: invalid_type1_options() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, Account::default()),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(OAppError::InvalidOptions)),
        "init_enforced_options should fail with InvalidOptions for type-1 options"
    );
}

/// options too short to contain a type header (< 2 bytes) → `InvalidOptionsLength`.
#[test]
fn test_init_enforced_options_fails_with_too_short_options() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, _) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &init_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: too_short_options() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, Account::default()),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(OAppError::InvalidOptionsLength)),
        "init_enforced_options should fail with InvalidOptionsLength for 1-byte options"
    );
}

/// duplicate init: enforced_options PDA already exists → `init` constraint rejects.
#[test]
fn test_init_enforced_options_fails_on_duplicate() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &init_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: valid_type3_options() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            // Already-initialised account → `init` must fail.
            (eo_key, enforced_options_account(&valid_type3_options(), eo_bump)),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(ProgramError::Custom(SYSTEM_ACCOUNT_ALREADY_IN_USE)),
        "duplicate init_enforced_options should fail with system AccountAlreadyInUse"
    );
}

// ── set_enforced_options ──────────────────────────────────────────────────────

/// non-admin tries to set enforced options → AccountNotInitialized.
#[test]
fn test_set_enforced_options_fails_for_non_admin() {
    let mollusk = mollusk();
    let payer = payer_key();
    let user = user_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (user_role_key, _) = role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &user);

    let result = mollusk.process_instruction(
        &set_enforced_options_ix(
            &user,
            &user,
            &counter_key,
            &eo_key,
            &user_role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: valid_type3_options() },
        ),
        &[
            (user, user_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, enforced_options_account(&valid_type3_options(), eo_bump)),
            sys_keyed(),
            (user_role_key, Account::default()), // non-existent → AccountNotInitialized
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "set_enforced_options should fail with AccountNotInitialized for non-admin"
    );
}

/// options with wrong type (type 1 instead of 3) → `InvalidOptions`.
#[test]
fn test_set_enforced_options_fails_with_wrong_options_type() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &set_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: invalid_type1_options() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, enforced_options_account(&valid_type3_options(), eo_bump)),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(OAppError::InvalidOptions)),
        "set_enforced_options should fail with InvalidOptions for type-1 options"
    );
}

/// options too short to contain a type header (< 2 bytes) → `InvalidOptionsLength`.
#[test]
fn test_set_enforced_options_fails_with_too_short_options() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &set_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: too_short_options() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, enforced_options_account(&valid_type3_options(), eo_bump)),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(OAppError::InvalidOptionsLength)),
        "set_enforced_options should fail with InvalidOptionsLength for 1-byte options"
    );
}

/// enforced_options PDA not yet initialized → `AccountNotInitialized`.
///
/// `set_enforced_options` uses `mut` + seeds + `bump = enforced_options.bump`; Anchor
/// tries to deserialize the account before the handler runs. An empty account fails.
#[test]
fn test_set_enforced_options_fails_when_not_initialized() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let (eo_key, _) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_instruction(
        &set_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: valid_type3_options() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, Account::default()), // not initialized → AccountNotInitialized
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotInitialized)),
        "set_enforced_options should fail with AccountNotInitialized when PDA not yet created"
    );
}

// ── lz_receive ────────────────────────────────────────────────────────────────

/// `lz_receive` with its declared accounts only; the Endpoint `clear` accounts are omitted.
fn lz_receive_ix(counter: &Pubkey, peer: &Pubkey, sender: [u8; 32]) -> Instruction {
    use anchor_lang::{InstructionData, ToAccountMetas};
    Instruction {
        program_id: program_id(),
        accounts: counter::accounts::LzReceive {
            oapp: to_program_pubkey(counter),
            peer: to_program_pubkey(peer),
        }
        .to_account_metas(None)
        .into_iter()
        .map(|meta| AccountMeta {
            pubkey: Pubkey::new_from_array(meta.pubkey.to_bytes()),
            is_signer: meta.is_signer,
            is_writable: meta.is_writable,
        })
        .collect(),
        data: counter::instruction::LzReceive {
            params: oapp::types::LzReceiveParams {
                src_eid: 30101,
                sender,
                nonce: 1,
                guid: [0x77; 32],
                message: vec![1],
                extra_data: vec![],
            },
        }
        .data(),
    }
}

/// A message whose sender is not the stored peer fails the peer constraint before anything runs.
#[test]
fn test_lz_receive_rejects_a_sender_that_is_not_the_peer() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let (peer_key, peer_bump) = peer_pda(&counter_key, 30101);

    let result = mollusk.process_instruction(
        &lz_receive_ix(&counter_key, &peer_key, [0xDD; 32]),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (peer_key, peer_account([0xCC; 32], peer_bump)),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::ConstraintRaw)),
    );
}

/// Without the Endpoint `clear` accounts the message cannot be cleared, so the receive fails and
/// the count it bumped rolls back.
#[test]
fn test_lz_receive_requires_the_clear_accounts() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let (peer_key, peer_bump) = peer_pda(&counter_key, 30101);

    let result = mollusk.process_instruction(
        &lz_receive_ix(&counter_key, &peer_key, [0xCC; 32]),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (peer_key, peer_account([0xCC; 32], peer_bump)),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::AccountNotEnoughKeys)),
    );
}
