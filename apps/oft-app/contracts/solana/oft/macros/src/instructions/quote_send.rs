//! Code generator for the `quote_send` instruction.
//!
//! EVM: IOFT.quoteSend(SendParam, bool _payInLzToken) → MessagingFee
//! No default implementation — users MUST provide a custom handler.

use crate::instructions::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oft::types::QuoteSendParams)),
        return_type: quote!((::oapp::endpoint::types::MessagingFee)),
        is_view: true,
        default_impl: None,
    }
}
