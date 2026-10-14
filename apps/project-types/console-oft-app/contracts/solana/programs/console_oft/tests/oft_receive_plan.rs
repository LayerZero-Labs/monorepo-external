//! Receive planning through the SBF binary: `lz_receive_types_info` names the planner's inputs,
//! and `lz_receive_types_v3` writes a plan whose accounts are `lz_receive`'s. Executing plans,
//! hook groups and scratch sizing are covered in `tests/integration`; the scratch contract itself
//! is `oapp::lz_plan`'s (omni-counter's `lz_plan_v3.rs`).
mod oft;

use anchor_lang::ToAccountMetas;
use console_oft::{codec, errors::OFTError};
use oapp::{
    common::AddressLocator,
    lz_receive_types_v3::{
        LzReceiveTypesV3Accounts, LzReceiveTypesV3Result, LZ_RECEIVE_TYPES_VERSION,
    },
    types::LzReceiveParams,
};
use oft::helpers::*;
use solana_account::Account;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use spl_token_2022::state::AccountState;

const RECIPIENT: [u8; 32] = [0x66; 32];

fn params() -> LzReceiveParams {
    LzReceiveParams {
        src_eid: DST_EID,
        sender: [0x44; 32],
        nonce: 1,
        guid: [0x77; 32],
        message: codec::msg::encode(RECIPIENT, 1_000, to_program_pubkey(&admin_key()), None),
        extra_data: vec![],
    }
}

fn recipient_ata(f: &OftFixture) -> Pubkey {
    host(anchor_spl::associated_token::get_associated_token_address_with_program_id(
        &anchor_lang::prelude::Pubkey::new_from_array(RECIPIENT),
        &to_program_pubkey(&f.token_mint),
        &to_program_pubkey(&mollusk_svm_programs_token::token2022::ID),
    ))
}

/// The planner for a recipient whose ATA does not exist yet.
fn planner(f: &OftFixture, redirect_escrow: Option<Pubkey>) -> Instruction {
    f.insert(recipient_ata(f), Account::default());
    oft_ix(
        console_oft::accounts::LzReceiveTypesV3 {
            payer: to_program_pubkey(&f.payer),
            plan_out: to_program_pubkey(&planner_output(f)),
            oft_store: to_program_pubkey(&f.oft_store),
            oft_escrow: to_program_pubkey(&f.oft_escrow),
            token_mint: to_program_pubkey(&f.token_mint),
            token_dest: to_program_pubkey(&recipient_ata(f)),
            token_program: to_program_pubkey(&mollusk_svm_programs_token::token2022::ID),
            extra_account_meta_list: None,
            pubkey_policy: f.store().pubkey_policy,
            acl_mint_config: None,
            acl_thaw_metas: None,
            redirect_escrow: redirect_escrow.as_ref().map(to_program_pubkey),
        },
        console_oft::instruction::LzReceiveTypesV3 { params: params() },
    )
}

fn configure_redirect(f: &OftFixture) -> Pubkey {
    let escrow = Pubkey::new_unique();
    f.insert(escrow, token_account(&f.token_mint, &f.admin, AccountState::Initialized));
    f.ok(&set_credit_redirect_config_ix(f, f.admin, Some(escrow)));
    escrow
}

/// Step 1 of the Executor's discovery: the planner's accounts after its payer and scratch, in
/// `LzReceiveTypesV3` declaration order, with the Anchor None sentinel for absent optionals.
#[test]
fn receive_types_info_names_the_planner_accounts_in_declaration_order() {
    for redirect in [false, true] {
        let f = fixture();
        let escrow = if redirect { configure_redirect(&f) } else { program_id() };
        let (version, accounts): (u8, LzReceiveTypesV3Accounts) =
            f.view(&lz_receive_types_info_ix(&f, params()));
        assert_eq!(version, LZ_RECEIVE_TYPES_VERSION);
        assert_eq!(
            accounts.accounts.into_iter().map(host).collect::<Vec<_>>(),
            [
                f.oft_store,
                f.oft_escrow,
                f.token_mint,
                recipient_ata(&f),
                mollusk_svm_programs_token::token2022::ID,
                program_id(), // no transfer hook: the manifest slot is absent
                program_id(), // no pubkey policy selected
                program_id(), // hence no Token ACL config
                program_id(), // or gate manifest either
                escrow,
            ]
        );
    }
}

/// Omitting the configured escrow would plan only direct delivery, which a later block could
/// not redirect.
#[test]
fn planner_rejects_an_omitted_configured_redirect_escrow() {
    let f = fixture();
    configure_redirect(&f);
    assert_eq!(f.fails(&planner(&f, None)), program_failure(OFTError::InvalidRedirectEscrow));
}

/// The plan names the selected policy and the recipient's canonical record without evaluating
/// them: only the policy's owner is read, to derive the record under that program. The policy's
/// data and the record do not exist here, because only execution may evaluate them.
#[test]
fn plan_names_lz_receive_accounts_including_unread_policy_accounts() {
    let f = fixture();
    let policy = Pubkey::new_unique();
    f.insert(policy, Account::new(1, 0, &host(pubkey_policy_interface::ID)));
    f.update_store(|store| store.pubkey_policy = Some(to_program_pubkey(&policy)));
    let result = f.ok(&planner(&f, None));
    let plan: LzReceiveTypesV3Result = decode_plan(&result, &plan_scratch());
    let [oapp::lz_receive_types_v3::Instruction::LzReceive { accounts }] = &plan.instructions[..]
    else {
        panic!("a receive plan is one lz_receive")
    };

    let record =
        pubkey_policy_interface::subject_address(&to_program_pubkey(&policy), &RECIPIENT.into()).0;
    let expected = console_oft::accounts::LzReceive {
        payer: to_program_pubkey(&f.payer),
        oft_store: to_program_pubkey(&f.oft_store),
        peer: to_program_pubkey(&f.peer),
        default_rate_limit: to_program_pubkey(&f.default_rate_limit),
        rate_limit: to_program_pubkey(&rate_limit_pda(&f.oft_store, DST_EID.into())),
        address_exemption: to_program_pubkey(&rate_limit_address_exemption_pda(
            &f.oft_store,
            &Pubkey::new_from_array(RECIPIENT),
        )),
        oft_escrow: to_program_pubkey(&f.oft_escrow),
        to_address: RECIPIENT.into(),
        token_dest: to_program_pubkey(&recipient_ata(&f)),
        redirect_escrow: None,
        pubkey_policy: Some(to_program_pubkey(&policy)),
        pubkey_policy_record: Some(record),
        token_mint: to_program_pubkey(&f.token_mint),
        mint_authority: Some(to_program_pubkey(&f.admin)),
        token_program: to_program_pubkey(&mollusk_svm_programs_token::token2022::ID),
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: Default::default(),
        // Not ACL-governed: no activation inputs.
        acl_mint_config: None,
        acl_thaw_metas: None,
        acl_flag: None,
        acl_program: None,
        acl_gate_program: None,
        event_authority: to_program_pubkey(&event_authority_pda()),
        program: console_oft::ID,
    }
    .to_account_metas(None);
    // Without hook, compose or redirect, only the Endpoint `clear` group follows.
    assert_eq!(accounts.len(), expected.len() + oapp::endpoint_cpi::CLEAR_MIN_ACCOUNTS_LEN);
    for (planned, expected) in accounts.iter().zip(&expected) {
        let key = match planned.pubkey {
            AddressLocator::Address(key) => key,
            AddressLocator::Payer => to_program_pubkey(&f.payer),
            _ => panic!("unexpected locator"),
        };
        assert_eq!((key, planned.is_writable), (expected.pubkey, expected.is_writable));
    }
}

/// A scratch is single-use, so a caller can never read a mix of two plans.
#[test]
fn planner_refuses_a_scratch_that_already_holds_a_plan() {
    let f = fixture();
    let planner = planner(&f, None);
    f.ok(&planner);
    assert_eq!(f.fails(&planner), program_failure(oapp::OAppError::InvalidPlanOutput));
}
