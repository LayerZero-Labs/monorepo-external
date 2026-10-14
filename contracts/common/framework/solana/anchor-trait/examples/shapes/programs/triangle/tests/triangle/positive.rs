use crate::helpers::*;
use anchor_lang::Discriminator;
use mollusk_svm::result::Check;
use shapes_triangle::{instruction as ix, ComputeParams, ScaleParams};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_creates_shape_with_correct_dimensions() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (shape_key, shape_bump) = shape_pda();

    mollusk.process_and_validate_instruction(
        &initialize_ix(&payer, &shape_key, 6, 4),
        &[(payer, payer_account()), (shape_key, Account::default()), sys_keyed()],
        &[Check::success(), Check::account(&shape_key).data(&shape_data(6, 4, shape_bump)).build()],
    );
}

// ── get_name ──────────────────────────────────────────────────────────────────

#[test]
fn test_get_name_returns_triangle() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new_readonly(shape_key, false)],
            data: ix::GetName::DISCRIMINATOR.to_vec(),
        },
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[Check::success()],
    );

    // Borsh String: 4-byte LE length prefix + UTF-8 bytes
    let ret = &result.return_data;
    let len = u32::from_le_bytes(ret[..4].try_into().unwrap()) as usize;
    assert_eq!(std::str::from_utf8(&ret[4..4 + len]).unwrap(), "Triangle");
}

// ── get_dimension ─────────────────────────────────────────────────────────────

#[test]
fn test_get_dimension_returns_width_at_index_0() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &get_dimension_ix(&shape_key, 0),
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[Check::success()],
    );

    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 6);
}

#[test]
fn test_get_dimension_returns_height_at_index_1() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &get_dimension_ix(&shape_key, 1),
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[Check::success()],
    );

    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 4);
}

// ── clear ─────────────────────────────────────────────────────────────────────

#[test]
fn test_clear_zeros_dimensions() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new(shape_key, false)],
            data: ix::Clear::DISCRIMINATOR.to_vec(),
        },
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[Check::success(), Check::account(&shape_key).data(&shape_data(0, 0, shape_bump)).build()],
    );
}

// ── compute_area ──────────────────────────────────────────────────────────────

/// Triangle override: w * h / 2; ExtComputeArea injects a verifier signer.
#[test]
fn test_compute_area_uses_triangle_formula() {
    let mollusk = mollusk();
    let verifier = verifier_key();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new_readonly(shape_key, false),
                AccountMeta::new(verifier, true),
            ],
            data: ix_data(ix::ComputeArea::DISCRIMINATOR, ComputeParams {}),
        },
        &[(shape_key, shape_account(6, 4, shape_bump)), (verifier, verifier_account())],
        &[Check::success()],
    );

    // 6 * 4 / 2 = 12
    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 12);
}

// ── compute_perimeter ─────────────────────────────────────────────────────────

/// Isoceles triangle override: w + w + h = 6 + 6 + 4 = 16.
#[test]
fn test_compute_perimeter_uses_isoceles_formula() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new_readonly(shape_key, false)],
            data: ix_data(ix::ComputePerimeter::DISCRIMINATOR, ComputeParams {}),
        },
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[Check::success()],
    );

    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 16);
}

// ── scale ─────────────────────────────────────────────────────────────────────

/// Isoceles override: only height scales, base stays fixed.
#[test]
fn test_scale_only_changes_height_for_isoceles_triangle() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new(shape_key, false)],
            data: ix_data(ix::Scale::DISCRIMINATOR, ScaleParams { factor: 3 }),
        },
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[
            Check::success(),
            Check::account(&shape_key).data(&shape_data(6, 12, shape_bump)).build(),
        ],
    );
}

// ── reset ─────────────────────────────────────────────────────────────────────

/// Default reset: sets both dimensions to 1.
#[test]
fn test_reset_sets_both_dimensions_to_one() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new(shape_key, false)],
            data: ix::Reset::DISCRIMINATOR.to_vec(),
        },
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[Check::success(), Check::account(&shape_key).data(&shape_data(1, 1, shape_bump)).build()],
    );
}

// ── get_dimension_count ───────────────────────────────────────────────────────

/// Default: always returns 2 for any 2D shape.
#[test]
fn test_get_dimension_count_returns_2() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new_readonly(shape_key, false)],
            data: ix::GetDimensionCount::DISCRIMINATOR.to_vec(),
        },
        &[(shape_key, shape_account(6, 4, shape_bump))],
        &[Check::success()],
    );

    assert_eq!(result.return_data[0], 2u8);
}
