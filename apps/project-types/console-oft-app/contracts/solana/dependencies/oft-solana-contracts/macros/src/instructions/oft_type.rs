//! Code generator for the `oft_type` instruction.
//!
//! Solana: returns the OFT mode.
//! No default implementation — users MUST provide a custom handler.

use crate::instructions::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
        return_type: quote!(::oft::types::OftType),
        is_view: true,
        default_impl: None,
    }
}
