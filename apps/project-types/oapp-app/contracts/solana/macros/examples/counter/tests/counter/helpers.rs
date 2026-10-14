//! Shared test helpers: PDA derivation, account builders, fixtures, and instruction utilities.

use anchor_lang::{prelude::borsh::BorshSerialize, Discriminator};
use counter::{
    instruction as ix,
    state::{CounterInfoEntry, CounterRoleType, CounterState, COUNTER_SEED},
    EnforcedOptions, OAppPeer, RoleMember,
};
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use oapp::{
    oapp_info::{OAppBase, TlvSpace, OAPP_BASE_IDL_VERSION, OAPP_BASE_SCHEMA_VERSION},
    types::{
        GetEnforcedOptionsParams, IsComposeMsgSenderParams, NextNonceParams,
        SetEnforcedOptionsParams, SetPeerParams,
    },
    ENFORCED_OPTIONS_SEED, NONCE_SEED, OAPP_INFO_SEED, PEER_SEED,
};
use rbac::ROLE_MEMBER_SEED;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::state::TlvStateMut;

pub const SYSTEM_PROGRAM: Pubkey = Pubkey::new_from_array([0u8; 32]);

// ── Program + PDA derivation ──────────────────────────────────────────────────

/// Bridge anchor-lang Pubkey (solana-program 2.x) → solana-pubkey 4.x via bytes.
pub fn program_id() -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(counter::ID.as_ref());
    Pubkey::new_from_array(bytes)
}

pub fn counter_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[COUNTER_SEED], &program_id())
}

/// RoleMember PDA: seeds = [ROLE_MEMBER_SEED, state_key, role_byte, member_key]
pub fn role_member_pda(state_key: &Pubkey, role: CounterRoleType, member: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ROLE_MEMBER_SEED, state_key.as_ref(), &[role as u8], member.as_ref()],
        &program_id(),
    )
}

/// Peer PDA: seeds = [PEER_SEED, state_key, eid_be_bytes]
pub fn peer_pda(state_key: &Pubkey, eid: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PEER_SEED, state_key.as_ref(), &eid.to_be_bytes()],
        &program_id(),
    )
}

/// EnforcedOptions PDA: seeds = [ENFORCED_OPTIONS_SEED, state_key, eid_be, msg_type_be]
pub fn enforced_options_pda(state_key: &Pubkey, eid: u32, msg_type: u16) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ENFORCED_OPTIONS_SEED, state_key.as_ref(), &eid.to_be_bytes(), &msg_type.to_be_bytes()],
        &program_id(),
    )
}

/// OAppInfo PDA: seeds = [OAPP_INFO_SEED] — program-level, one per program.
pub fn oapp_info_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[OAPP_INFO_SEED], &program_id())
}

/// Endpoint nonce PDA: seeds = [NONCE_SEED, state_key, src_eid_be, sender] under the Endpoint
/// program.
pub fn nonce_pda(state_key: &Pubkey, src_eid: u32, sender: &[u8; 32]) -> (Pubkey, u8) {
    let mut endpoint_id = [0u8; 32];
    endpoint_id.copy_from_slice(oapp::endpoint::ID.as_ref());
    Pubkey::find_program_address(
        &[NONCE_SEED, state_key.as_ref(), &src_eid.to_be_bytes(), sender],
        &Pubkey::new_from_array(endpoint_id),
    )
}

/// Event authority PDA injected by `#[event_cpi]`: seeds = [b"__event_authority"]
pub fn event_authority_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"__event_authority"], &program_id())
}

/// Bridge solana-pubkey 4.x → anchor-lang's solana-program 2.x Pubkey.
pub fn to_program_pubkey(key: &Pubkey) -> anchor_lang::prelude::Pubkey {
    anchor_lang::prelude::Pubkey::new_from_array(*key.as_array())
}

pub fn mollusk() -> Mollusk {
    // `anchor build` outputs .so relative to the Cargo workspace root.
    // Walk up from the crate to find the nearest Cargo.lock (workspace root)
    // which is where target/deploy/ lives.
    let binary = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|p| p.join("Cargo.lock").exists())
        .expect("Cargo.lock not found — workspace root missing")
        .join("target/deploy/counter");
    Mollusk::new(&program_id(), binary.to_str().unwrap())
}

// ── Instruction data ──────────────────────────────────────────────────────────

pub fn ix_data<T: BorshSerialize>(discriminator: &[u8], params: T) -> Vec<u8> {
    let mut d = discriminator.to_vec();
    d.extend(borsh::to_vec(&params).unwrap());
    d
}

/// Assert that the event in `data` matches `expected`.
///
/// Layout: `[__event_cpi discriminator (8)][event discriminator (8)][borsh fields]`.
pub fn assert_event<T: BorshSerialize + Discriminator>(data: &[u8], expected: T) {
    assert_eq!(&data[8..16], T::DISCRIMINATOR, "event discriminator mismatch");
    let actual_bytes = &data[16..];
    let expected_bytes = borsh::to_vec(&expected).expect("serialize expected");
    assert_eq!(actual_bytes, expected_bytes.as_slice(), "event payload mismatch");
}

// ── Account data builders ─────────────────────────────────────────────────────

pub fn counter_data(
    count: u64,
    bump: u8,
    current_admin: &Pubkey,
    pending_admin: &Pubkey,
) -> Vec<u8> {
    let mut d = CounterState::DISCRIMINATOR.to_vec();
    d.extend(
        borsh::to_vec(&CounterState {
            count,
            bump,
            current_default_admin: to_program_pubkey(current_admin),
            pending_default_admin: to_program_pubkey(pending_admin),
        })
        .unwrap(),
    );
    d
}

pub fn counter_account(
    count: u64,
    bump: u8,
    current_admin: &Pubkey,
    pending_admin: &Pubkey,
) -> Account {
    Account {
        lamports: 1_000_000,
        data: counter_data(count, bump, current_admin, pending_admin),
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}

/// Raw on-chain bytes for a `RoleMember` scoped to the single state account (`counter_pda`).
pub fn role_member_data(role: CounterRoleType, account_key: &Pubkey, bump: u8) -> Vec<u8> {
    let mut d = RoleMember::DISCRIMINATOR.to_vec();
    d.extend(
        borsh::to_vec(&RoleMember {
            state: to_program_pubkey(&counter_pda().0),
            role,
            account: to_program_pubkey(account_key),
            bump,
        })
        .unwrap(),
    );
    d
}

pub fn role_member_account(role: CounterRoleType, account_key: &Pubkey, bump: u8) -> Account {
    Account {
        lamports: 1_000_000,
        data: role_member_data(role, account_key, bump),
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}

pub fn peer_data(address: [u8; 32], bump: u8) -> Vec<u8> {
    let mut d = OAppPeer::DISCRIMINATOR.to_vec();
    d.extend(borsh::to_vec(&OAppPeer { address, bump }).unwrap());
    d
}

pub fn peer_account(address: [u8; 32], bump: u8) -> Account {
    Account {
        lamports: 1_000_000,
        data: peer_data(address, bump),
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}

pub fn enforced_options_data(options: &[u8], bump: u8) -> Vec<u8> {
    let mut d = EnforcedOptions::DISCRIMINATOR.to_vec();
    d.extend(borsh::to_vec(&EnforcedOptions { options: options.to_vec(), bump }).unwrap());
    d
}

pub fn enforced_options_account(options: &[u8], bump: u8) -> Account {
    Account {
        lamports: 1_000_000,
        data: enforced_options_data(options, bump),
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}

/// Minimal executable account for the `program` field injected by `#[event_cpi]`.
/// The program's loader-v3 account, as Mollusk registers it: its owner is the loader that runs it.
pub fn counter_program_account() -> Account {
    mollusk_svm::program::create_program_account_loader_v3(&program_id())
}

// ── Options fixtures ──────────────────────────────────────────────────────────

/// Valid type-3 options header: big-endian u16 = 3.
pub fn valid_type3_options() -> Vec<u8> {
    vec![0x00, 0x03]
}

/// Type-1 options — not allowed by `assert_type_3` → `InvalidOptions`.
pub fn invalid_type1_options() -> Vec<u8> {
    vec![0x00, 0x01]
}

/// Single-byte options — too short for any type header → `InvalidOptionsLength`.
pub fn too_short_options() -> Vec<u8> {
    vec![0x01]
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/// Sentinel for `pending_default_admin = "none"`.
/// The rbac crate stores `Pubkey::default()` ([0u8; 32]) when no transfer is pending.
pub fn no_pending_admin() -> Pubkey {
    Pubkey::new_from_array([0u8; 32])
}

fn wallet_account() -> Account {
    Account::new(10_000_000, 0, &SYSTEM_PROGRAM)
}

pub fn payer_key() -> Pubkey {
    Pubkey::new_from_array([0xAA; 32])
}

pub fn payer_account() -> Account {
    wallet_account()
}

pub fn user_key() -> Pubkey {
    Pubkey::new_from_array([0xBB; 32])
}

pub fn user_account() -> Account {
    wallet_account()
}

// ── Error helpers ─────────────────────────────────────────────────────────────

/// Build `ProgramError::Custom(N)` from any error type that converts to a `u32` code.
pub fn program_err(e: impl Into<u32>) -> ProgramError {
    ProgramError::Custom(e.into())
}

// ── Keyed-account helpers ─────────────────────────────────────────────────────

pub fn sys_keyed() -> (Pubkey, Account) {
    keyed_account_for_system_program()
}

pub fn event_authority_keyed() -> (Pubkey, Account) {
    let (key, _) = event_authority_pda();
    (key, Account::default())
}

pub fn counter_program_keyed() -> (Pubkey, Account) {
    (program_id(), counter_program_account())
}

// ── Instruction builders ──────────────────────────────────────────────────────
//
// One builder per instruction captures the fixed account layout (slot order,
// mut/readonly/signer flags) while accepting all variable keys as parameters.

/// Initialize account order (after `#[init_default_admin]` injection + `#[event_cpi]`):
///   0: payer, 1: state, 2: oapp_info, 3: system_program, 4: admin_role_member,
///   5: event_authority, 6: program
pub fn initialize_ix(
    payer: &Pubkey,
    counter: &Pubkey,
    oapp_info: &Pubkey,
    admin_role: &Pubkey,
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*counter, false),
            AccountMeta::new(*oapp_info, false),
            AccountMeta::new_readonly(sys, false),
            AccountMeta::new(*admin_role, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix::Initialize::DISCRIMINATOR.to_vec(),
    }
}

/// `set_peer` (+ `#[only_role]` then `#[event_cpi]`) account order:
///   0: authority, 1: payer, 2: oapp, 3: peer, 4: system_program,
///   5: role_member (only_role), 6: event_authority, 7: program
///
/// `role_member` — the authority's DefaultAdmin PDA (may be wrong in negative tests).
pub fn set_peer_ix(
    authority: &Pubkey,
    payer: &Pubkey,
    counter: &Pubkey,
    peer: &Pubkey,
    role_member: &Pubkey,
    eid: u32,
    peer_address: [u8; 32],
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*counter, false),
            AccountMeta::new(*peer, false),
            AccountMeta::new_readonly(sys, false),
            AccountMeta::new_readonly(*role_member, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix_data(ix::SetPeer::DISCRIMINATOR, SetPeerParams { eid, peer: peer_address }),
    }
}

/// `get_peer` (view, no role check, no event_cpi):
///   0: oapp, 1: peer
pub fn get_peer_ix(counter: &Pubkey, peer: &Pubkey, eid: u32) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*counter, false),
            AccountMeta::new_readonly(*peer, false),
        ],
        data: ix_data(ix::GetPeer::DISCRIMINATOR, eid),
    }
}

/// `init_enforced_options` (+ `#[only_role]` then `#[event_cpi]`) account order:
///   0: authority, 1: payer, 2: oapp, 3: enforced_options, 4: system_program,
///   5: role_member (only_role), 6: event_authority, 7: program
pub fn init_enforced_options_ix(
    authority: &Pubkey,
    payer: &Pubkey,
    counter: &Pubkey,
    enforced_options: &Pubkey,
    role_member: &Pubkey,
    params: SetEnforcedOptionsParams,
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*counter, false),
            AccountMeta::new(*enforced_options, false),
            AccountMeta::new_readonly(sys, false),
            AccountMeta::new_readonly(*role_member, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix_data(ix::InitEnforcedOptions::DISCRIMINATOR, params),
    }
}

/// `set_enforced_options` (+ `#[only_role]` then `#[event_cpi]`) — same layout as init;
///   `enforced_options` must already exist (created by `init_enforced_options`).
pub fn set_enforced_options_ix(
    authority: &Pubkey,
    payer: &Pubkey,
    counter: &Pubkey,
    enforced_options: &Pubkey,
    role_member: &Pubkey,
    params: SetEnforcedOptionsParams,
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*counter, false),
            AccountMeta::new(*enforced_options, false),
            AccountMeta::new_readonly(sys, false),
            AccountMeta::new_readonly(*role_member, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix_data(ix::SetEnforcedOptions::DISCRIMINATOR, params),
    }
}

/// `get_enforced_options` (view):
///   0: oapp, 1: enforced_options
pub fn get_enforced_options_ix(
    counter: &Pubkey,
    enforced_options: &Pubkey,
    params: GetEnforcedOptionsParams,
) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*counter, false),
            AccountMeta::new_readonly(*enforced_options, false),
        ],
        data: ix_data(ix::GetEnforcedOptions::DISCRIMINATOR, params),
    }
}

/// `next_nonce` (view):
///   0: oapp, 1: nonce_account (UncheckedAccount)
pub fn next_nonce_ix(
    counter: &Pubkey,
    nonce_account: &Pubkey,
    params: NextNonceParams,
) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*counter, false),
            AccountMeta::new_readonly(*nonce_account, false),
        ],
        data: ix_data(ix::NextNonce::DISCRIMINATOR, params),
    }
}

/// `is_compose_msg_sender` (view):
///   0: oapp
pub fn is_compose_msg_sender_ix(counter: &Pubkey, params: IsComposeMsgSenderParams) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![AccountMeta::new_readonly(*counter, false)],
        data: ix_data(ix::IsComposeMsgSender::DISCRIMINATOR, params),
    }
}

/// `update_oapp_info` account order:
///   0: authority, 1: state, 2: oapp_info
pub fn update_oapp_info_ix(
    authority: &Pubkey,
    counter: &Pubkey,
    oapp_info: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*counter, false),
            AccountMeta::new(*oapp_info, false),
        ],
        data: ix::UpdateOappInfo::DISCRIMINATOR.to_vec(),
    }
}

// ── OAppInfo account builder ──────────────────────────────────────────────────

/// Build a pre-initialised `oapp_info` account containing the two TLV entries
/// written by `initialize`: `OAppBase` (schema_version = 1, idl_version =
/// { major: 2, minor: 0 }) followed by `CounterInfoEntry`
/// (version = `CounterInfoEntry::VERSION`, max_count = u64::MAX).
///
/// Use this to set up the `oapp_info` account state before calling instructions
/// that mutate it (e.g., `update_oapp_info`).
pub fn oapp_info_account() -> Account {
    let oapp_entry = OAppBase {
        schema_version: OAPP_BASE_SCHEMA_VERSION,
        idl_version: OAPP_BASE_IDL_VERSION,
        app_discriminator: <[u8; 8]>::from(CounterInfoEntry::SPL_DISCRIMINATOR),
    };
    let counter_entry = CounterInfoEntry::new();

    let total = OAppBase::TLV_SPACE + CounterInfoEntry::TLV_SPACE;
    let mut data = vec![0u8; total];
    {
        let mut tlv = TlvStateMut::unpack(&mut data).unwrap();
        tlv.alloc_and_pack_variable_len_entry(&oapp_entry, false).unwrap();
        tlv.alloc_and_pack_variable_len_entry(&counter_entry, false).unwrap();
    }

    Account {
        lamports: 1_000_000,
        data,
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}
