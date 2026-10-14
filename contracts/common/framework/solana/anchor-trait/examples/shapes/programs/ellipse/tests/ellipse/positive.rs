use crate::helpers::*;
use anchor_lang::Discriminator;
use mollusk_svm::result::Check;
use shapes_ellipse::{instruction as ix, ComputeParams, ScaleParams};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_creates_shape_with_correct_dimensions() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (shape_key, shape_bump) = shape_pda();

    mollusk.process_and_validate_instruction(
        &initialize_ix(&payer, &shape_key, 10, 6),
        &[(payer, payer_account()), (shape_key, Account::default()), sys_keyed()],
        &[
            Check::success(),
            Check::account(&shape_key).data(&shape_data(10, 6, shape_bump)).build(),
        ],
    );
}

// ── get_name ──────────────────────────────────────────────────────────────────

#[test]
fn test_get_name_returns_ellipse() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new_readonly(shape_key, false)],
            data: ix::GetName::DISCRIMINATOR.to_vec(),
        },
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[Check::success()],
    );

    // Borsh String: 4-byte LE length prefix + UTF-8 bytes
    let ret = &result.return_data;
    let len = u32::from_le_bytes(ret[..4].try_into().unwrap()) as usize;
    assert_eq!(std::str::from_utf8(&ret[4..4 + len]).unwrap(), "Ellipse");
}

// ── get_dimension ─────────────────────────────────────────────────────────────

#[test]
fn test_get_dimension_returns_semi_axis_a_at_index_0() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &get_dimension_ix(&shape_key, 0),
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[Check::success()],
    );

    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 10);
}

#[test]
fn test_get_dimension_returns_semi_axis_b_at_index_1() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &get_dimension_ix(&shape_key, 1),
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[Check::success()],
    );

    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 6);
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
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[Check::success(), Check::account(&shape_key).data(&shape_data(0, 0, shape_bump)).build()],
    );
}

// ── compute_area ──────────────────────────────────────────────────────────────

/// Ellipse override: π * w * h / 4 (StdComputeArea accounts, readonly shape).
#[test]
fn test_compute_area_uses_ellipse_formula() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new_readonly(shape_key, false)],
            data: ix_data(ix::ComputeArea::DISCRIMINATOR, ComputeParams {}),
        },
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[Check::success()],
    );

    // 314_159 * 10 * 6 / 400_000 = 47
    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 47);
}

// ── compute_perimeter ─────────────────────────────────────────────────────────

/// Ellipse override: π * (w + h) / 2 (custom EllipseAccounts).
#[test]
fn test_compute_perimeter_uses_ellipse_approximation() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new_readonly(shape_key, false)],
            data: ix_data(ix::ComputePerimeter::DISCRIMINATOR, ComputeParams {}),
        },
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[Check::success()],
    );

    // 314_159 * (10 + 6) / 200_000 = 25
    assert_eq!(u64::from_le_bytes(result.return_data[..8].try_into().unwrap()), 25);
}

// ── scale ─────────────────────────────────────────────────────────────────────

/// Default scale: both axes scaled equally.
#[test]
fn test_scale_default_scales_both_axes() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new(shape_key, false)],
            data: ix_data(ix::Scale::DISCRIMINATOR, ScaleParams { factor: 2 }),
        },
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[
            Check::success(),
            Check::account(&shape_key).data(&shape_data(20, 12, shape_bump)).build(),
        ],
    );
}

// ── reset ─────────────────────────────────────────────────────────────────────

/// Ellipse override: resets to unit circle (width = height = 10).
#[test]
fn test_reset_restores_unit_circle() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    mollusk.process_and_validate_instruction(
        &Instruction {
            program_id: program_id(),
            accounts: vec![AccountMeta::new(shape_key, false)],
            data: ix::Reset::DISCRIMINATOR.to_vec(),
        },
        &[(shape_key, shape_account(30, 5, shape_bump))],
        &[
            Check::success(),
            Check::account(&shape_key).data(&shape_data(10, 10, shape_bump)).build(),
        ],
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
        &[(shape_key, shape_account(10, 6, shape_bump))],
        &[Check::success()],
    );

    assert_eq!(result.return_data[0], 2u8);
}
