//! Code generator for the `scale` instruction.
//!
//! Provided instruction with default handler: multiply both dimensions by a factor.
//! Demonstrates a **provided + mutable** instruction (the only combination not covered
//! by the other five instructions, which are all view or required).

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec(_ctx: &CodegenContext) -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(ScaleParams)),
        return_type: quote!(()),
        is_view: false,
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
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdScale<'info> {
                #[account(mut)]
                pub shape: Account<'info, #state_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdScale<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<()> {
                    let s = &mut ctx.accounts.shape;
                    s.width = s.width.saturating_mul(params.factor);
                    s.height = s.height.saturating_mul(params.factor);
                    Ok(())
                }
            }
        },
    }
}
