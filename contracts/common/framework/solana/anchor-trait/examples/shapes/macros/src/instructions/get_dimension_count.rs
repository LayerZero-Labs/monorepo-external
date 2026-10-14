//! Code generator for the `get_dimension_count` instruction.
//!
//! Provided instruction with no params. Default returns 2 (all shapes are 2D).

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec(_ctx: &CodegenContext) -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
        return_type: quote!(u8),
        is_view: true,
        default_impl: Some(DefaultImpl {
            handler_ident: format_ident!("apply"),
            generator: generate_default_context,
        }),
    }
}

fn generate_default_context(
    ctx: &CodegenContext,
    spec: &InstructionSpec<CodegenContext>,
) -> DefaultAccounts {
    let state_type = &ctx.state_type;
    let return_type = &spec.return_type;
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdGetDimensionCount<'info> {
                pub shape: Account<'info, #state_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdGetDimensionCount<'_> {
                pub fn #handler_ident(_ctx: &Context<Self>) -> Result<#return_type> {
                    Ok(2)
                }
            }
        },
    }
}
