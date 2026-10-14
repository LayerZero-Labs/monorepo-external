//! Code generator for the `send` instruction.
//!
//! EVM: IOFT.send(SendParam, MessagingFee, address _refundAddress) → (MessagingReceipt, OFTReceipt)
//! No default implementation — users MUST provide a custom handler.

use crate::instructions::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oft::types::SendParams)),
        return_type: quote!((::oapp::endpoint::types::MessagingReceipt, ::oft::types::OFTReceipt)),
        is_view: false,
        default_impl: None,
    }
}
