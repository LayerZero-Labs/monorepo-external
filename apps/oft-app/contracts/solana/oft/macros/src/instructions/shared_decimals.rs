//! Code generator for the `shared_decimals` instruction.
//!
//! EVM: IOFT.sharedDecimals() → uint8
//! No default implementation — users MUST provide a custom handler.

use crate::instructions::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
        return_type: quote!(u8),
        is_view: true,
        default_impl: None,
    }
}
