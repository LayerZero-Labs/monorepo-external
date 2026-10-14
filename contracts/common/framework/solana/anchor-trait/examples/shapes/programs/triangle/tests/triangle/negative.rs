use crate::helpers::*;
use mollusk_svm::result::types::ProgramResult;
use solana_program_error::ProgramError;

// ── initialize ────────────────────────────────────────────────────────────────

/// double-init: shape account already exists → `init` constraint rejects.
#[test]
fn test_initialize_fails_on_double_init() {
    let mollusk = mollusk();
    let payer = payer_key();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_instruction(
        &initialize_ix(&payer, &shape_key, 6, 4),
        &[
            (payer, payer_account()),
            // Supply pre-existing shape account → `init` must fail.
            (shape_key, shape_account(6, 4, shape_bump)),
            sys_keyed(),
        ],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(ProgramError::Custom(0)),
        "double-init should fail with system AccountAlreadyInUse"
    );
}

// ── get_dimension ─────────────────────────────────────────────────────────────

/// index out of range (index = 2) → `InvalidProgramId`.
#[test]
fn test_get_dimension_fails_with_out_of_bounds_index() {
    let mollusk = mollusk();
    let (shape_key, shape_bump) = shape_pda();

    let result = mollusk.process_instruction(
        &get_dimension_ix(&shape_key, 2),
        &[(shape_key, shape_account(6, 4, shape_bump))],
    );

    assert_eq!(
        result.program_result,
        ProgramResult::Failure(program_err(anchor_lang::error::ErrorCode::InvalidProgramId)),
        "get_dimension should fail with InvalidProgramId for out-of-bounds index"
    );
}
