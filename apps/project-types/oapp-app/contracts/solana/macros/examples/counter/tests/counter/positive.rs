use crate::helpers::*;
use anchor_lang::AnchorDeserialize;
use counter::state::{CounterInfoEntry, CounterRoleType};
use mollusk_svm::result::Check;
use oapp::{
    events::{EnforcedOptionsSet, PeerSet},
    oapp_info::{IdlVersion, OAppBase, OAPP_BASE_IDL_VERSION, OAPP_BASE_SCHEMA_VERSION},
    types::{
        GetEnforcedOptionsParams, IsComposeMsgSenderParams, NextNonceParams,
        SetEnforcedOptionsParams,
    },
};
use solana_account::Account;
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::state::{TlvState, TlvStateBorrowed};

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_creates_counter_state_and_admin_role_member() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let (admin_role_key, admin_role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);
    let (oapp_info_key, _) = oapp_info_pda();

    // Initialize account order (after #[init_default_admin] injection + #[event_cpi]):
    //   0: payer, 1: state, 2: oapp_info, 3: system_program, 4: admin_role_member,
    //   5: event_authority, 6: program
    mollusk.process_and_validate_instruction(
        &initialize_ix(&payer, &counter_key, &oapp_info_key, &admin_role_key),
        &[
            (payer, payer_account()),
            (counter_key, Account::default()),
            (oapp_info_key, Account::default()),
            sys_keyed(),
            (admin_role_key, Account::default()),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
        &[
            Check::success(),
            Check::account(&counter_key)
                .data(&counter_data(0, counter_bump, &payer, &no_pending_admin()))
                .build(),
            Check::account(&admin_role_key)
                .data(&role_member_data(CounterRoleType::DefaultAdmin, &payer, admin_role_bump))
                .build(),
        ],
    );
}

// ── initialize oapp_info TLV ──────────────────────────────────────────────────

#[test]
fn test_initialize_writes_oapp_info_tlv_entries() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, _) = counter_pda();
    let (admin_role_key, _) = role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);
    let (oapp_info_key, _) = oapp_info_pda();

    let result = mollusk.process_and_validate_instruction(
        &initialize_ix(&payer, &counter_key, &oapp_info_key, &admin_role_key),
        &[
            (payer, payer_account()),
            (counter_key, Account::default()),
            (oapp_info_key, Account::default()),
            sys_keyed(),
            (admin_role_key, Account::default()),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
        &[Check::success()],
    );

    let oapp_info_data = result
        .get_account(&oapp_info_key)
        .expect("oapp_info account missing")
        .data
        .clone();

    // TLV starts at byte 0 — UncheckedAccount carries no Anchor discriminator.
    let tlv = TlvStateBorrowed::unpack(&oapp_info_data).expect("invalid TLV state");

    // ── OAppBase (discriminator: "oapp::base") ───────────────────────
    let oapp_entry: OAppBase = tlv.get_first_variable_len_value().expect("OAppBase not found");
    assert_eq!(oapp_entry.schema_version, OAPP_BASE_SCHEMA_VERSION);
    assert_eq!(oapp_entry.idl_version, OAPP_BASE_IDL_VERSION);
    assert_eq!(oapp_entry.app_discriminator, <[u8; 8]>::from(CounterInfoEntry::SPL_DISCRIMINATOR),);

    // ── CounterInfoEntry (discriminator: "counter::info") ────────────────
    let counter_entry: CounterInfoEntry =
        tlv.get_first_variable_len_value().expect("CounterInfoEntry not found");
    assert_eq!(counter_entry.version, CounterInfoEntry::VERSION);
    assert_eq!(counter_entry.max_count, u64::MAX);
}

// ── update_oapp_info ──────────────────────────────────────────────────────────

#[test]
fn test_update_oapp_info_bumps_idl_version_minor() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let (oapp_info_key, _) = oapp_info_pda();

    // update_oapp_info account order: 0: authority, 1: state, 2: oapp_info
    let result = mollusk.process_and_validate_instruction(
        &update_oapp_info_ix(&payer, &counter_key, &oapp_info_key),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (oapp_info_key, oapp_info_account()),
        ],
        &[Check::success()],
    );

    let oapp_info_data = result
        .get_account(&oapp_info_key)
        .expect("oapp_info account missing")
        .data
        .clone();

    let tlv = TlvStateBorrowed::unpack(&oapp_info_data).expect("invalid TLV state");
    let entry: OAppBase = tlv.get_first_variable_len_value().expect("OAppBase not found");
    assert_eq!(entry.schema_version, OAPP_BASE_SCHEMA_VERSION);
    assert_eq!(
        entry.idl_version,
        IdlVersion { major: OAPP_BASE_IDL_VERSION.major, minor: OAPP_BASE_IDL_VERSION.minor + 1 },
    );
}

// ── set_peer ──────────────────────────────────────────────────────────────────

#[test]
fn test_set_peer_creates_peer_account() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let peer_address = [0xCC; 32];
    let (peer_key, peer_bump) = peer_pda(&counter_key, eid);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    // set_peer (+ #[only_role] + #[event_cpi]):
    //   0: authority, 1: payer, 2: oapp, 3: peer, 4: system_program,
    //   5: role_member (only_role), 6: event_authority, 7: program
    let result = mollusk.process_and_validate_instruction(
        &set_peer_ix(&payer, &payer, &counter_key, &peer_key, &role_key, eid, peer_address),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (peer_key, Account::default()),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
        &[
            Check::success(),
            Check::inner_instruction_count(2), /* create_account (init_if_needed) + __event_cpi
                                                * (PeerSet) */
            Check::account(&peer_key).data(&peer_data(peer_address, peer_bump)).build(),
        ],
    );

    assert_event(
        &result.inner_instructions[1].instruction.data,
        PeerSet { oapp: to_program_pubkey(&counter_key), eid, peer: peer_address },
    );
}

// ── get_peer ──────────────────────────────────────────────────────────────────

#[test]
fn test_get_peer_returns_some_peer_address() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let peer_address = [0xCC; 32];
    let (peer_key, peer_bump) = peer_pda(&counter_key, eid);

    let result = mollusk.process_and_validate_instruction(
        &get_peer_ix(&counter_key, &peer_key, eid),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (peer_key, peer_account(peer_address, peer_bump)),
        ],
        &[Check::success()],
    );

    let returned =
        Option::<[u8; 32]>::try_from_slice(&result.return_data).expect("failed to decode option");
    assert_eq!(returned, Some(peer_address));
}

#[test]
fn test_get_peer_returns_none_when_not_set() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 99999;
    let (peer_key, _) = peer_pda(&counter_key, eid);

    let result = mollusk.process_and_validate_instruction(
        &get_peer_ix(&counter_key, &peer_key, eid),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (peer_key, Account::default()),
        ],
        &[Check::success()],
    );

    let returned =
        Option::<[u8; 32]>::try_from_slice(&result.return_data).expect("failed to decode option");
    assert_eq!(returned, None);
}

/// Regression: an initialized peer PDA holding the zero address is normalized
/// to `None` so `is_some()` is a reliable existence check.
#[test]
fn test_get_peer_returns_none_for_zero_address() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let (peer_key, peer_bump) = peer_pda(&counter_key, eid);

    let result = mollusk.process_and_validate_instruction(
        &get_peer_ix(&counter_key, &peer_key, eid),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (peer_key, peer_account([0u8; 32], peer_bump)),
        ],
        &[Check::success()],
    );

    let returned =
        Option::<[u8; 32]>::try_from_slice(&result.return_data).expect("failed to decode option");
    assert_eq!(returned, None);
}

// ── init_enforced_options ─────────────────────────────────────────────────────

#[test]
fn test_init_enforced_options_creates_account() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let options = valid_type3_options();
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    // init_enforced_options (+ #[only_role] + #[event_cpi]):
    //   0: authority, 1: payer, 2: oapp, 3: enforced_options, 4: system_program,
    //   5: role_member (only_role), 6: event_authority, 7: program
    let result = mollusk.process_and_validate_instruction(
        &init_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: options.clone() },
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
        &[
            Check::success(),
            Check::inner_instruction_count(2), // create_account + __event_cpi
            Check::account(&eo_key).data(&enforced_options_data(&options, eo_bump)).build(),
        ],
    );

    assert_event(
        &result.inner_instructions[1].instruction.data,
        EnforcedOptionsSet { oapp: to_program_pubkey(&counter_key), eid, msg_type, options },
    );
}

/// empty options skips `assert_type_3` entirely and stores an empty vec.
#[test]
fn test_init_enforced_options_succeeds_with_empty_options() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let options: Vec<u8> = vec![];
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_and_validate_instruction(
        &init_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: options.clone() },
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
        &[
            Check::success(),
            Check::inner_instruction_count(2), // create_account + __event_cpi
            Check::account(&eo_key).data(&enforced_options_data(&options, eo_bump)).build(),
        ],
    );

    assert_event(
        &result.inner_instructions[1].instruction.data,
        EnforcedOptionsSet { oapp: to_program_pubkey(&counter_key), eid, msg_type, options },
    );
}

// ── set_enforced_options ──────────────────────────────────────────────────────

#[test]
fn test_set_enforced_options_updates_options() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let old_options = valid_type3_options();
    let new_options = vec![0x00, 0x03, 0xAB, 0xCD]; // extended type-3 options
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    // set_enforced_options (+ #[only_role] + #[event_cpi]) — same account layout as init.
    let result = mollusk.process_and_validate_instruction(
        &set_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: new_options.clone() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, enforced_options_account(&old_options, eo_bump)),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
        &[
            Check::success(),
            Check::inner_instruction_count(2), // system transfer (realloc) + __event_cpi
            Check::account(&eo_key)
                .data(&enforced_options_data(&new_options, eo_bump))
                .build(),
        ],
    );

    assert_event(
        &result.inner_instructions[1].instruction.data,
        EnforcedOptionsSet {
            oapp: to_program_pubkey(&counter_key),
            eid,
            msg_type,
            options: new_options,
        },
    );
}

/// empty options skips `assert_type_3`; account shrinks (realloc refunds payer).
#[test]
fn test_set_enforced_options_succeeds_with_empty_options() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let old_options = valid_type3_options();
    let new_options: Vec<u8> = vec![];
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);
    let (role_key, role_bump) =
        role_member_pda(&counter_key, CounterRoleType::DefaultAdmin, &payer);

    let result = mollusk.process_and_validate_instruction(
        &set_enforced_options_ix(
            &payer,
            &payer,
            &counter_key,
            &eo_key,
            &role_key,
            SetEnforcedOptionsParams { eid, msg_type, options: new_options.clone() },
        ),
        &[
            (payer, payer_account()),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, enforced_options_account(&old_options, eo_bump)),
            sys_keyed(),
            (role_key, role_member_account(CounterRoleType::DefaultAdmin, &payer, role_bump)),
            event_authority_keyed(),
            counter_program_keyed(),
        ],
        &[
            Check::success(),
            Check::account(&eo_key)
                .data(&enforced_options_data(&new_options, eo_bump))
                .build(),
        ],
    );

    assert_event(
        &result.inner_instructions.last().unwrap().instruction.data,
        EnforcedOptionsSet {
            oapp: to_program_pubkey(&counter_key),
            eid,
            msg_type,
            options: new_options,
        },
    );
}

// ── get_enforced_options ──────────────────────────────────────────────────────

#[test]
fn test_get_enforced_options_returns_some_options() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 30101;
    let msg_type: u16 = 1;
    let options = valid_type3_options();
    let (eo_key, eo_bump) = enforced_options_pda(&counter_key, eid, msg_type);

    // StdGetEnforcedOptions accounts: [oapp, enforced_options]
    let result = mollusk.process_and_validate_instruction(
        &get_enforced_options_ix(&counter_key, &eo_key, GetEnforcedOptionsParams { eid, msg_type }),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, enforced_options_account(&options, eo_bump)),
        ],
        &[Check::success()],
    );

    let returned =
        Option::<Vec<u8>>::try_from_slice(&result.return_data).expect("failed to decode options");
    assert_eq!(returned, Some(options));
}

#[test]
fn test_get_enforced_options_returns_none_when_not_set() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let eid: u32 = 99999;
    let msg_type: u16 = 1;
    let (eo_key, _) = enforced_options_pda(&counter_key, eid, msg_type);

    let result = mollusk.process_and_validate_instruction(
        &get_enforced_options_ix(&counter_key, &eo_key, GetEnforcedOptionsParams { eid, msg_type }),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (eo_key, Account::default()),
        ],
        &[Check::success()],
    );

    let returned =
        Option::<Vec<u8>>::try_from_slice(&result.return_data).expect("failed to decode options");
    assert_eq!(returned, None);
}

// ── next_nonce ────────────────────────────────────────────────────────────────

#[test]
fn test_next_nonce_returns_zero() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();
    let src_eid: u32 = 30101;
    let sender = [0xCC; 32];
    let (nonce_key, _) = nonce_pda(&counter_key, src_eid, &sender);

    // StdNextNonce accounts: [oapp, nonce_account (UncheckedAccount)]
    let result = mollusk.process_and_validate_instruction(
        &next_nonce_ix(&counter_key, &nonce_key, NextNonceParams { src_eid, sender }),
        &[
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
            (nonce_key, Account::default()),
        ],
        &[Check::success()],
    );

    // Default implementation always returns 0 (no ordering enforcement).
    let nonce = u64::try_from_slice(&result.return_data).expect("failed to decode nonce");
    assert_eq!(nonce, 0);
}

// ── is_compose_msg_sender ─────────────────────────────────────────────────────

#[test]
fn test_is_compose_msg_sender_returns_true_for_oapp() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();

    // Default impl: returns true only when compose_sender == oapp.key()
    let result = mollusk.process_and_validate_instruction(
        &is_compose_msg_sender_ix(
            &counter_key,
            IsComposeMsgSenderParams {
                src_eid: 30101,
                sender: [0xCC; 32],
                nonce: 1,
                message: vec![],
                compose_sender: to_program_pubkey(&counter_key),
            },
        ),
        &[(counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin()))],
        &[Check::success()],
    );

    let is_sender = bool::try_from_slice(&result.return_data).expect("failed to decode bool");
    assert!(is_sender);
}

#[test]
fn test_is_compose_msg_sender_returns_false_for_other() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (counter_key, counter_bump) = counter_pda();

    let result = mollusk.process_and_validate_instruction(
        &is_compose_msg_sender_ix(
            &counter_key,
            IsComposeMsgSenderParams {
                src_eid: 30101,
                sender: [0xCC; 32],
                nonce: 1,
                message: vec![],
                compose_sender: to_program_pubkey(&payer), // not the oapp key
            },
        ),
        &[(counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin()))],
        &[Check::success()],
    );

    let is_sender = bool::try_from_slice(&result.return_data).expect("failed to decode bool");
    assert!(!is_sender);
}

// ── lz_receive_types_v3 ───────────────────────────────────────────────────────

/// The plan names exactly `lz_receive`'s own accounts, in declaration order, then the Endpoint
/// `clear` accounts `lz_receive` forwards as remaining accounts.
#[test]
fn test_receive_plan_matches_lz_receive_accounts() {
    use anchor_lang::{InstructionData, ToAccountMetas};
    use oapp::{
        common::AccountMetaRef,
        lz_receive_types_v3::{
            get_accounts_for_clear, Instruction as Planned, LzReceiveTypesV3Result,
        },
        types::LzReceiveParams,
    };
    let mollusk = mollusk();
    let payer = payer_key();
    let scratch = solana_pubkey::Pubkey::new_from_array([0xBB; 32]);
    let (counter_key, counter_bump) = counter_pda();
    let params = LzReceiveParams {
        src_eid: 30101,
        sender: [0xCC; 32],
        nonce: 1,
        guid: [0x77; 32],
        message: vec![1],
        extra_data: vec![],
    };
    let planner = solana_instruction::Instruction {
        program_id: program_id(),
        accounts: vec![
            solana_instruction::AccountMeta::new(payer, true),
            solana_instruction::AccountMeta::new(scratch, true),
            solana_instruction::AccountMeta::new_readonly(counter_key, false),
        ],
        data: counter::instruction::LzReceiveTypesV3 { params: params.clone() }.data(),
    };
    let result = mollusk.process_and_validate_instruction(
        &planner,
        &[
            (payer, Account::new(10_000_000, 0, &SYSTEM_PROGRAM)),
            (
                scratch,
                Account {
                    lamports: 1_000_000,
                    data: vec![0; 1024],
                    owner: program_id(),
                    ..Account::default()
                },
            ),
            (counter_key, counter_account(0, counter_bump, &payer, &no_pending_admin())),
        ],
        &[Check::success()],
    );
    let length = u32::from_le_bytes(result.return_data[..4].try_into().unwrap()) as usize;
    let data = &result.get_account(&scratch).unwrap().data;
    let plan = LzReceiveTypesV3Result::try_from_slice(&data[..length]).unwrap();
    let [Planned::LzReceive { accounts }] = &plan.instructions[..] else {
        panic!("expected exactly one lz_receive instruction")
    };

    let (peer_key, _) = peer_pda(&counter_key, params.src_eid);
    let own: Vec<AccountMetaRef> = counter::accounts::LzReceive {
        oapp: to_program_pubkey(&counter_key),
        peer: to_program_pubkey(&peer_key),
    }
    .to_account_metas(None)
    .into_iter()
    .map(|meta| AccountMetaRef { pubkey: meta.pubkey.into(), is_writable: meta.is_writable })
    .collect();
    let clear = get_accounts_for_clear(
        oapp::endpoint::ID,
        &to_program_pubkey(&counter_key),
        params.src_eid,
        &params.sender,
        params.nonce,
    );
    assert_eq!(accounts[..], [own, clear].concat()[..]);
}
