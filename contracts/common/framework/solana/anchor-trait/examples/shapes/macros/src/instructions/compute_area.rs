//! Code generator for the `compute_area` instruction.
//!
//! Provided instruction with default handler: width * height (rectangle area).

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec(_ctx: &CodegenContext) -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(ComputeParams)),
        return_type: quote!(u64),
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
    let params_type = spec.params_type.as_ref().unwrap();
    let return_type = &spec.return_type;
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdComputeArea<'info> {
                pub shape: Account<'info, #state_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdComputeArea<'_> {
                pub fn #handler_ident(ctx: &Context<Self>, _params: &#params_type) -> Result<#return_type> {
                    let s = &ctx.accounts.shape;
                    Ok(s.width * s.height)
                }
            }
        },
    }
}
