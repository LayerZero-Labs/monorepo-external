//! Code generator for the `get_name` instruction.
//!
//! This is a **required** instruction — the implementor must return the shape's
//! name. There is no sensible default, so every consumer must provide a handler.

use anchor_trait::InstructionSpec;
use quote::quote;

use super::CodegenContext;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
        return_type: quote!(String),
        is_view: true,
        default_impl: None, // Required — implementor MUST provide
    }
}
