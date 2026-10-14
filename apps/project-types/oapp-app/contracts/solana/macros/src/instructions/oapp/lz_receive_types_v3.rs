//! Code generator for the `lz_receive_types_v3` instruction.
//!
//! Required override (no default). The handler writes its plan with `oapp::lz_plan::write` and
//! returns the plan's encoded length; see `docs/lz-receive-types.md`.

use super::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::LzReceiveParams)),
        return_type: quote!(u32),
        is_view: false,
        default_impl: None,
    }
}
