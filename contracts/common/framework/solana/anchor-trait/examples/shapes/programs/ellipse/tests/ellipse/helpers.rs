//! Shared test helpers: PDA derivation, account builders, fixtures, and instruction builders.

use anchor_lang::{prelude::borsh, AnchorSerialize, Discriminator};
use mollusk_svm::{program::keyed_account_for_system_program, Mollusk};
use shapes_ellipse::{instruction as ix, DimensionParams, InitParams, ShapeState};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

// ── Program + PDA derivation ──────────────────────────────────────────────────

/// Bridge anchor-lang Pubkey (solana-program 2.x) → solana-pubkey 4.x via bytes.
pub fn program_id() -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(shapes_ellipse::ID.as_ref());
    Pubkey::new_from_array(bytes)
}

/// Shape PDA: seeds = [b"shape"]
pub fn shape_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"shape"], &program_id())
}

pub fn mollusk() -> Mollusk {
    // `anchor build` outputs .so relative to the Cargo workspace root.
    // Walk up from the crate to find the nearest Cargo.lock (workspace root)
    // which is where target/deploy/ lives.
    let binary = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|p| p.join("Cargo.lock").exists())
        .expect("Cargo.lock not found — workspace root missing")
        .join("target/deploy/shapes_ellipse");
    Mollusk::new(&program_id(), binary.to_str().unwrap())
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

pub fn payer_key() -> Pubkey {
    Pubkey::new_from_array([0xAA; 32])
}

pub fn payer_account() -> Account {
    Account::new(10_000_000, 0, &Pubkey::new_from_array([0u8; 32]))
}

pub fn sys_keyed() -> (Pubkey, Account) {
    keyed_account_for_system_program()
}

// ── Serialization helpers ─────────────────────────────────────────────────────

pub fn ix_data<T: AnchorSerialize>(discriminator: &[u8], params: T) -> Vec<u8> {
    let mut d = discriminator.to_vec();
    d.extend(borsh::to_vec(&params).unwrap());
    d
}

// ── Account data builders ─────────────────────────────────────────────────────

pub fn shape_data(width: u64, height: u64, bump: u8) -> Vec<u8> {
    let mut d = ShapeState::DISCRIMINATOR.to_vec();
    d.extend_from_slice(&width.to_le_bytes());
    d.extend_from_slice(&height.to_le_bytes());
    d.push(bump);
    d
}

pub fn shape_account(width: u64, height: u64, bump: u8) -> Account {
    Account {
        lamports: 1_000_000,
        data: shape_data(width, height, bump),
        owner: program_id(),
        executable: false,
        rent_epoch: u64::MAX,
    }
}

// ── Error helpers ─────────────────────────────────────────────────────────────

pub fn program_err(e: impl Into<u32>) -> ProgramError {
    ProgramError::Custom(e.into())
}

// ── Instruction builders ──────────────────────────────────────────────────────

/// `initialize` (Anchor `init` on shape PDA):
///   0: payer, 1: shape, 2: system_program
pub fn initialize_ix(payer: &Pubkey, shape: &Pubkey, width: u64, height: u64) -> Instruction {
    let (sys, _) = sys_keyed();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*shape, false),
            AccountMeta::new_readonly(sys, false),
        ],
        data: ix_data(ix::Initialize::DISCRIMINATOR, InitParams { width, height }),
    }
}

/// `get_dimension` (view):
///   0: shape
pub fn get_dimension_ix(shape: &Pubkey, index: u8) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![AccountMeta::new_readonly(*shape, false)],
        data: ix_data(ix::GetDimension::DISCRIMINATOR, DimensionParams { index }),
    }
}
