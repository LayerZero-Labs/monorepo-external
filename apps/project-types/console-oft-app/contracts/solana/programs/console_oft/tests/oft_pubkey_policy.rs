//! Receive screening at the OFT boundary, through the SBF binary on a mint with neither ACL nor a
//! hook. These receives carry no Endpoint accounts: an admitted credit gets as far as parsing
//! them and stops with `InsufficientRemainingAccounts`, a blocked one stops with `CreditBlocked`.
//! Delivery, redirect execution and live policy programs are in `tests/integration`.
mod oft;

use anchor_lang::AccountSerialize;
use console_oft::{codec, errors::OFTError, events::PubkeyPolicySet, state::CreditRedirectConfig};
use mollusk_svm_result::types::ProgramResult;
use oapp::types::LzReceiveParams;
use oft::helpers::*;
use pubkey_policy_interface::{
    pubkey_policy_address, subject_address, Membership, PubkeyPolicy, PubkeyPolicyMode,
    SubjectRecord,
};
use solana_account::Account;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use spl_token_2022::state::AccountState;

fn admitted() -> ProgramResult {
    program_failure(OFTError::InsufficientRemainingAccounts)
}

fn blocked() -> ProgramResult {
    program_failure(OFTError::CreditBlocked)
}

/// A policy-program-owned policy from a fresh initializer. Anyone may create same-mint policies,
/// so the OFT must reject substitution by its selected key.
fn insert_policy(f: &OftFixture, mode: PubkeyPolicyMode, mint: Pubkey) -> Pubkey {
    let key = host(
        pubkey_policy_address(&to_program_pubkey(&mint), &to_program_pubkey(&Pubkey::new_unique()))
            .0,
    );
    let mut data = Vec::new();
    PubkeyPolicy {
        mint: to_program_pubkey(&mint),
        current_default_admin: to_program_pubkey(&f.admin),
        pending_default_admin: Default::default(),
        mode,
    }
    .try_serialize(&mut data)
    .unwrap();
    f.insert(
        key,
        Account { data, ..Account::new(10_000_000, 0, &host(pubkey_policy_interface::ID)) },
    );
    key
}

/// `subject`'s canonical record under `policy`; `None` leaves it unallocated.
fn insert_record(
    f: &OftFixture,
    policy: Pubkey,
    subject: Pubkey,
    flags: Option<Membership>,
) -> Pubkey {
    let key = host(subject_address(&to_program_pubkey(&policy), &to_program_pubkey(&subject)).0);
    let mut account = Account::default();
    if let Some(membership) = flags {
        let mut data = Vec::new();
        SubjectRecord {
            policy: to_program_pubkey(&policy),
            subject: to_program_pubkey(&subject),
            membership,
        }
        .try_serialize(&mut data)
        .unwrap();
        account =
            Account { data, ..Account::new(1_000_000, 0, &host(pubkey_policy_interface::ID)) };
    }
    f.insert(key, account);
    key
}

fn select_policy(f: &OftFixture, mode: PubkeyPolicyMode) -> Pubkey {
    let policy = insert_policy(f, mode, f.token_mint);
    f.ok(&set_pubkey_policy_ix(f, f.admin, Some(policy)));
    policy
}

fn recipient_ata(f: &OftFixture) -> Pubkey {
    host(anchor_spl::associated_token::get_associated_token_address_with_program_id(
        &to_program_pubkey(&f.user),
        &to_program_pubkey(&f.token_mint),
        &to_program_pubkey(&mollusk_svm_programs_token::token2022::ID),
    ))
}

/// A receive to `f.user`, whose existing ATA is in `state`.
fn receive(
    f: &OftFixture,
    policy: Option<Pubkey>,
    record: Option<Pubkey>,
    state: AccountState,
    redirect: Option<Pubkey>,
) -> Instruction {
    f.insert(recipient_ata(f), token_account(&f.token_mint, &f.user, state));
    let k = |key: &Pubkey| to_program_pubkey(key);
    oft_ix(
        console_oft::accounts::LzReceive {
            payer: k(&f.payer),
            oft_store: k(&f.oft_store),
            peer: k(&f.peer),
            default_rate_limit: k(&f.default_rate_limit),
            rate_limit: k(&rate_limit_pda(&f.oft_store, DST_EID.into())),
            address_exemption: k(&rate_limit_address_exemption_pda(&f.oft_store, &f.user)),
            oft_escrow: k(&f.oft_escrow),
            to_address: k(&f.user),
            token_dest: k(&recipient_ata(f)),
            redirect_escrow: redirect.as_ref().map(k),
            pubkey_policy: policy.as_ref().map(k),
            pubkey_policy_record: record.as_ref().map(k),
            acl_mint_config: None,
            acl_thaw_metas: None,
            acl_flag: None,
            acl_program: None,
            acl_gate_program: None,
            token_mint: k(&f.token_mint),
            mint_authority: Some(k(&f.admin)),
            token_program: k(&mollusk_svm_programs_token::token2022::ID),
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: Default::default(),
            event_authority: k(&event_authority_pda()),
            program: console_oft::ID,
        },
        console_oft::instruction::LzReceive {
            params: LzReceiveParams {
                src_eid: DST_EID,
                sender: [0x44; 32],
                nonce: 1,
                guid: [0x77; 32],
                message: codec::msg::encode(f.user.to_bytes(), 1, k(&f.admin), None),
                extra_data: vec![],
            },
        },
    )
}

fn result(f: &OftFixture, ix: &Instruction) -> ProgramResult {
    f.context.process_instruction(ix).program_result
}

#[test]
fn admin_selects_replaces_and_clears_the_policy() {
    let f = fixture();
    let oft_store = to_program_pubkey(&f.oft_store);
    for policy in [
        Some(insert_policy(&f, PubkeyPolicyMode::Blacklist, f.token_mint)),
        Some(insert_policy(&f, PubkeyPolicyMode::Whitelist, f.token_mint)),
        None,
    ] {
        let result = f.ok(&set_pubkey_policy_ix(&f, f.admin, policy));
        let policy = policy.as_ref().map(to_program_pubkey);
        assert_only_event(&result, PubkeyPolicySet { oft_store, pubkey_policy: policy });
        assert_eq!(f.store().pubkey_policy, policy);
    }
}

/// Selection stores the admin's choice unchecked. Receive enforces what the choice must satisfy:
/// the policy is for this mint, and the record lives under the policy's owner program.
#[test]
fn selection_is_the_admins_choice_and_receive_enforces_mint_and_owner() {
    let f = fixture();
    let other_mint = insert_policy(&f, PubkeyPolicyMode::Open, Pubkey::new_unique());
    // A policy under another program: its records must live under that program too.
    let other_program = insert_policy(&f, PubkeyPolicyMode::Open, f.token_mint);
    f.context.account_store.borrow_mut().get_mut(&other_program).unwrap().owner = program_id();
    for (policy, error) in
        [(other_mint, OFTError::InvalidPubkeyPolicyMint), (other_program, OFTError::WrongRecord)]
    {
        f.ok(&set_pubkey_policy_ix(&f, f.admin, Some(policy)));
        assert_eq!(f.store().pubkey_policy, Some(to_program_pubkey(&policy)));
        let record = insert_record(&f, policy, f.user, None);
        assert_eq!(
            result(&f, &receive(&f, Some(policy), Some(record), AccountState::Initialized, None)),
            program_failure(error)
        );
    }
}

/// The credit is blocked when the recipient's own record blocks it under the live mode, or when
/// its token account is natively frozen; each mode reads membership independently.
#[test]
fn receive_admission_follows_the_recipient_record_and_native_freeze() {
    use PubkeyPolicyMode::*;
    let listed = |blacklisted, whitelisted| Some(Membership { blacklisted, whitelisted });
    for (mode, membership, state, expected) in [
        (Open, listed(true, false), AccountState::Initialized, admitted()),
        (Blacklist, None, AccountState::Initialized, admitted()),
        (Blacklist, listed(true, true), AccountState::Initialized, blocked()),
        (Blacklist, None, AccountState::Frozen, blocked()),
        (Whitelist, None, AccountState::Initialized, blocked()),
        (Whitelist, listed(true, true), AccountState::Initialized, admitted()),
        (Whitelist, listed(false, true), AccountState::Frozen, blocked()),
    ] {
        let f = fixture();
        let policy = select_policy(&f, mode);
        let record = insert_record(&f, policy, f.user, membership);
        assert_eq!(
            result(&f, &receive(&f, Some(policy), Some(record), state, None)),
            expected,
            "{mode:?} {membership:?} {state:?}"
        );
    }
}

/// Screening cannot be disabled by omitting its accounts or satisfied by another policy's.
#[test]
fn configured_policy_accounts_cannot_be_omitted_or_substituted() {
    let f = fixture();
    let policy = select_policy(&f, PubkeyPolicyMode::Whitelist);
    let record = insert_record(&f, policy, f.user, None);
    let open = insert_policy(&f, PubkeyPolicyMode::Open, f.token_mint);
    let open_record = insert_record(&f, open, f.user, None);
    for (policy, record, error) in [
        (None, None, OFTError::InvalidPubkeyPolicy),
        (Some(policy), None, OFTError::InvalidPubkeyPolicy),
        (None, Some(record), OFTError::InvalidPubkeyPolicy),
        (Some(open), Some(open_record), OFTError::InvalidPubkeyPolicy),
        (Some(policy), Some(open_record), OFTError::WrongRecord),
    ] {
        let ix = receive(&f, policy, record, AccountState::Initialized, None);
        assert_eq!(result(&f, &ix), program_failure(error));
    }
}

/// The record must be the recipient's canonical, policy-program-owned record — checked even when
/// the recipient's account is frozen and would be blocked anyway.
#[test]
fn subject_record_must_be_the_recipients_canonical_record() {
    for state in [AccountState::Initialized, AccountState::Frozen] {
        let f = fixture();
        let policy = select_policy(&f, PubkeyPolicyMode::Open);
        let foreign = insert_record(&f, policy, f.user, Some(Membership::default()));
        f.context.account_store.borrow_mut().get_mut(&foreign).unwrap().owner = program_id();
        let other_subject = insert_record(&f, policy, f.admin, None);
        for (record, error) in
            [(foreign, OFTError::WrongOwner), (other_subject, OFTError::WrongRecord)]
        {
            assert_eq!(
                result(&f, &receive(&f, Some(policy), Some(record), state, None)),
                program_failure(error),
                "{state:?}"
            );
        }
    }
}

#[test]
fn without_a_selected_policy_policy_accounts_are_rejected() {
    let f = fixture();
    let policy = insert_policy(&f, PubkeyPolicyMode::Open, f.token_mint);
    let record = insert_record(&f, policy, f.user, None);
    assert_eq!(
        result(&f, &receive(&f, Some(policy), Some(record), AccountState::Initialized, None)),
        program_failure(OFTError::InvalidPubkeyPolicy)
    );
    assert_eq!(result(&f, &receive(&f, None, None, AccountState::Initialized, None)), admitted());
}

/// With redirect configured a blocked recipient is admitted (to be credited to the escrow). An
/// escrow that is the recipient's own account is plain delivery, not a duplicate-account error.
#[test]
fn a_configured_redirect_escrow_admits_a_blocked_recipient() {
    let f = fixture();
    let policy = select_policy(&f, PubkeyPolicyMode::Whitelist);
    let record = insert_record(&f, policy, f.user, None);
    for escrow in [f.fee_deposit, recipient_ata(&f)] {
        f.update_store(|store| {
            store.credit_redirect_config =
                Some(CreditRedirectConfig { redirect_escrow: to_program_pubkey(&escrow) })
        });
        let ix = receive(&f, Some(policy), Some(record), AccountState::Initialized, Some(escrow));
        assert_eq!(result(&f, &ix), admitted());
    }
}
