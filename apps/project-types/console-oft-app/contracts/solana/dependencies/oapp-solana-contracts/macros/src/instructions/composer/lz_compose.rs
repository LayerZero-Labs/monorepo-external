//! Code generator for the `lz_compose` instruction.
//!
//! This instruction has no default implementation — users MUST provide
//! a custom handler named `lz_compose` with `#[composer_instruction]`.

use super::ComposerCodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<ComposerCodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::LzComposeParams)),
        return_type: quote!(()),
        is_view: false,
        default_impl: None,
    }
}
