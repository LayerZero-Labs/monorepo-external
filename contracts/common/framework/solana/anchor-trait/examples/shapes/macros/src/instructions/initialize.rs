//! Code generator for the `initialize` instruction.
//!
//! This is a **required** instruction — the implementor must provide their own
//! handler and accounts struct. There is no default implementation.

use anchor_trait::InstructionSpec;
use quote::quote;

use super::CodegenContext;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(InitParams)),
        return_type: quote!(()),
        is_view: false,
        default_impl: None, // Required — implementor MUST provide
    }
}
