//! Code generator for the `lz_compose_types_info` instruction.
//!
//! Required override (no default). Users MUST provide a custom handler
//! named `lz_compose_types_info` with `#[composer_instruction]`.
//!
//! The off-chain LayerZero Executor invokes this instruction with a fixed
//! 2-account list, in this order:
//!   1. `composer_account` — the program-specific Composer store
//!   2. `lz_compose_types_accounts` PDA at `[LZ_COMPOSE_TYPES_SEED, composer_account.key()]`
//!
//! Custom handlers MUST declare an `Accounts` struct matching this shape.
//! The framework does not enforce it at compile time, so a mismatch only
//! surfaces as a runtime failure when the Executor calls the deployed program.
//!
//! This follows the same V3 account-discovery model as `lz_receive_types_info`.
//! See `docs/lz-compose-types.md` for the compose-specific differences.

use super::ComposerCodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<ComposerCodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::LzComposeParams)),
        return_type: quote!((u8, ::oapp::lz_compose_types_v3::LzComposeTypesV3Accounts)),
        is_view: true,
        default_impl: None,
    }
}
