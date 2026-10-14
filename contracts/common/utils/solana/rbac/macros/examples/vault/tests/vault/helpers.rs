//! Shared test helpers: PDA derivation, account builders, fixtures, and instruction utilities.
use anchor_lang::{prelude::borsh::BorshSerialize, Discriminator};
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use rbac::{
    types::{GrantRoleParams, RenounceRoleParams, RevokeRoleParams},
    ROLE_MEMBER_SEED,
};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use vault::{
    instruction as ix,
    state::{VaultRoleType, VaultState, VAULT_SEED},
    RoleMember,
};

pub const SYSTEM_PROGRAM: Pubkey = Pubkey::new_from_array([0u8; 32]);

// ── Program + PDA derivation ──────────────────────────────────────────────────

/// Bridge anchor-lang Pubkey (solana-program 2.x) → solana-pubkey 4.x via bytes.
pub fn program_id() -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(vault::ID.as_ref());
    Pubkey::new_from_array(bytes)
}

pub fn vault_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED], &program_id())
}

/// RoleMember PDA: seeds = [ROLE_MEMBER_SEED, state_key, role_byte, member_key]
pub fn role_member_pda(state_key: &Pubkey, role: VaultRoleType, member: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ROLE_MEMBER_SEED, state_key.as_ref(), &[role as u8], member.as_ref()],
        &program_id(),
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
        .join("target/deploy/vault");
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

/// Raw on-chain bytes for a `VaultState` account (discriminator + fields).
pub fn vault_data(
    balance: u64,
    bump: u8,
    current_admin: &Pubkey,
    pending_admin: &Pubkey,
) -> Vec<u8> {
    let mut d = VaultState::DISCRIMINATOR.to_vec();
    d.extend(
        borsh::to_vec(&VaultState {
            balance,
            bump,
            current_default_admin: to_program_pubkey(current_admin),
            pending_default_admin: to_program_pubkey(pending_admin),
        })
        .unwrap(),
    );
    d
}

pub fn vault_account(
    balance: u64,
    bump: u8,
    current_admin: &Pubkey,
    pending_admin: &Pubkey,
) -> Account {
    Account {
        lamports: 1_000_000,
        data: vault_data(balance, bump, current_admin, pending_admin),
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}

/// Raw on-chain bytes for a `RoleMember` scoped to the single state account (`vault_pda`).
pub fn role_member_data(role: VaultRoleType, account_key: &Pubkey, bump: u8) -> Vec<u8> {
    let mut d = RoleMember::DISCRIMINATOR.to_vec();
    d.extend(
        borsh::to_vec(&RoleMember {
            state: to_program_pubkey(&vault_pda().0),
            role,
            account: to_program_pubkey(account_key),
            bump,
        })
        .unwrap(),
    );
    d
}

pub fn role_member_account(role: VaultRoleType, account_key: &Pubkey, bump: u8) -> Account {
    Account {
        lamports: 1_000_000,
        data: role_member_data(role, account_key, bump),
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}

/// Minimal executable account for the `program` field injected by `#[event_cpi]`.
/// Anchor's `Program<>` constraint only checks `executable == true` and the key.
/// The program's loader-v3 account, as Mollusk registers it: its owner is the loader that runs it.
pub fn vault_program_account() -> Account {
    mollusk_svm::program::create_program_account_loader_v3(&program_id())
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

/// A third key used as an unauthorised / wrong signer in negative tests.
pub fn other_key() -> Pubkey {
    Pubkey::new_from_array([0xCC; 32])
}

pub fn other_account() -> Account {
    wallet_account()
}

// ── Error helpers ─────────────────────────────────────────────────────────────

/// Build `ProgramError::Custom(N)` from any error type that converts to a `u32` code.
pub fn program_err(e: impl Into<u32>) -> ProgramError {
    ProgramError::Custom(e.into())
}

// ── Keyed-account helpers ─────────────────────────────────────────────────────
//
// These eliminate the boilerplate variable declarations that appear at the top of
// every test that uses the system program or the `#[event_cpi]` accounts.

pub fn sys_keyed() -> (Pubkey, Account) {
    keyed_account_for_system_program()
}

pub fn event_authority_keyed() -> (Pubkey, Account) {
    let (key, _) = event_authority_pda();
    (key, Account::default())
}

pub fn vault_program_keyed() -> (Pubkey, Account) {
    (program_id(), vault_program_account())
}

// ── Instruction builders ──────────────────────────────────────────────────────
//
// One builder per instruction captures the fixed account layout (slot order,
// mut/readonly/signer flags) while accepting all variable keys as parameters.
// Negative tests that intentionally pass a wrong key in one slot simply supply
// that key as the relevant argument.

/// Initialize account order (after `#[init_default_admin]` injection + `#[event_cpi]`):
///   0: payer, 1: vault, 2: system_program, 3: admin_role_member,
///   4: event_authority, 5: program
pub fn initialize_ix(payer: &Pubkey, vault: &Pubkey, admin_role: &Pubkey) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(sys, false),
            AccountMeta::new(*admin_role, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix::Initialize::DISCRIMINATOR.to_vec(),
    }
}

pub fn deposit_ix(
    authority: &Pubkey,
    vault: &Pubkey,
    role_member: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(*role_member, false),
        ],
        data: ix_data(ix::Deposit::DISCRIMINATOR, amount),
    }
}

/// `role_admin_member` — key placed in the admin-proof slot (may be a wrong key in negative tests).
/// `role_member`       — key placed in the grantee slot.
pub fn grant_role_ix(
    authority: &Pubkey,
    payer: &Pubkey,
    vault: &Pubkey,
    role_admin_member: &Pubkey,
    role_member: &Pubkey,
    role: VaultRoleType,
    grantee: &Pubkey,
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*vault, false),
            AccountMeta::new_readonly(*role_admin_member, false),
            AccountMeta::new(*role_member, false),
            AccountMeta::new_readonly(sys, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix_data(
            ix::GrantRole::DISCRIMINATOR,
            GrantRoleParams { role, account: to_program_pubkey(grantee) },
        ),
    }
}

/// `role_admin_member` — key placed in the admin-proof slot (may be a wrong key in negative tests).
/// `role_member`       — key placed in the target-role slot.
pub fn revoke_role_ix(
    authority: &Pubkey,
    receiver: &Pubkey,
    vault: &Pubkey,
    role_admin_member: &Pubkey,
    role_member: &Pubkey,
    role: VaultRoleType,
    target: &Pubkey,
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*receiver, false),
            AccountMeta::new_readonly(*vault, false),
            AccountMeta::new_readonly(*role_admin_member, false),
            AccountMeta::new(*role_member, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix_data(
            ix::RevokeRole::DISCRIMINATOR,
            RevokeRoleParams { role, account: to_program_pubkey(target) },
        ),
    }
}

/// `role_member` — key placed in the renouncer's role slot (may be a wrong key in negative tests).
pub fn renounce_role_ix(
    authority: &Pubkey,
    receiver: &Pubkey,
    vault: &Pubkey,
    role_member: &Pubkey,
    role: VaultRoleType,
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*receiver, false),
            AccountMeta::new_readonly(*vault, false),
            AccountMeta::new(*role_member, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix_data(ix::RenounceRole::DISCRIMINATOR, RenounceRoleParams { role }),
    }
}

pub fn begin_transfer_ix(authority: &Pubkey, vault: &Pubkey, new_admin: &Pubkey) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix_data(ix::BeginDefaultAdminTransfer::DISCRIMINATOR, to_program_pubkey(new_admin)),
    }
}

pub fn accept_transfer_ix(
    authority: &Pubkey,
    payer: &Pubkey,
    vault: &Pubkey,
    old_admin_role: &Pubkey,
    new_admin_role: &Pubkey,
) -> Instruction {
    let (event_authority, _) = event_authority_pda();
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(*vault, false),
            AccountMeta::new(*old_admin_role, false),
            AccountMeta::new(*new_admin_role, false),
            AccountMeta::new_readonly(sys, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(program_id(), false),
        ],
        data: ix::AcceptDefaultAdminTransfer::DISCRIMINATOR.to_vec(),
    }
}
