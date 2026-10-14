//! Code generator for the `reset` instruction.
//!
//! Provided instruction with no params. Default resets both dimensions to 1.
//! Demonstrates a **provided + mutable + no-params** instruction.

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec(_ctx: &CodegenContext) -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
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
    _spec: &InstructionSpec<CodegenContext>,
) -> DefaultAccounts {
    let state_type = &ctx.state_type;
    let handler_ident = format_ident!("apply");

    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdReset<'info> {
                #[account(mut)]
                pub shape: Account<'info, #state_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdReset<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>) -> Result<()> {
                    let s = &mut ctx.accounts.shape;
                    s.width = 1;
                    s.height = 1;
                    Ok(())
                }
            }
        },
    }
}
