//! Code generator for the `clear` instruction.
//!
//! Required instruction with no params. Zeros all mutable state.
//! Demonstrates a **required + mutable + no-params** instruction — every shape
//! must implement this since each shape's zero-state may differ.

use anchor_trait::InstructionSpec;
use quote::quote;

use super::CodegenContext;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
        return_type: quote!(()),
        is_view: false,
        default_impl: None, // Required — implementor MUST provide
    }
}
