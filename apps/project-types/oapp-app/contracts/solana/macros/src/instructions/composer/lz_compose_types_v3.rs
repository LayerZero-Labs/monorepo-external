//! Code generator for the `lz_compose_types_v3` instruction.
//!
//! Required override (no default). Users MUST provide a custom handler named
//! `lz_compose_types_v3` with `#[composer_instruction]`. The handler writes its plan with
//! `oapp::lz_plan::write` and returns the plan's encoded length; see `docs/lz-compose-types.md`.

use super::ComposerCodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<ComposerCodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::LzComposeParams)),
        return_type: quote!(u32),
        is_view: false,
        default_impl: None,
    }
}
