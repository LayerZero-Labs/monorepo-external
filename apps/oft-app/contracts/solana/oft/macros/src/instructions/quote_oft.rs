//! Code generator for the `quote_oft` instruction.
//!
//! EVM: IOFT.quoteOFT(SendParam) → (OFTLimit, OFTFeeDetail[], OFTReceipt)
//! No default implementation — users MUST provide a custom handler.

use crate::instructions::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oft::types::QuoteOFTParams)),
        return_type: quote!(::oft::types::QuoteOFTResult),
        is_view: true,
        default_impl: None,
    }
}
