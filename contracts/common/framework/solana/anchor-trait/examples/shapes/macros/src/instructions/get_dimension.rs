//! Code generator for the `get_dimension` instruction.
//!
//! Required instruction with params. Returns one dimension by index (0=width, 1=height).
//! Demonstrates a **required + view + params** instruction — every shape must implement
//! this since there is no sensible universal default for dimension indexing.

use anchor_trait::InstructionSpec;
use quote::quote;

use super::CodegenContext;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(DimensionParams)),
        return_type: quote!(u64),
        is_view: true,
        default_impl: None, // Required — implementor MUST provide
    }
}
