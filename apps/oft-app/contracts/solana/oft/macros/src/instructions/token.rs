//! Code generator for the `oft_token` instruction.
//!
//! EVM: IOFT.token() → address
//! No default implementation — users MUST provide a custom handler.

use crate::instructions::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
        return_type: quote!(Pubkey),
        is_view: true,
        default_impl: None,
    }
}
