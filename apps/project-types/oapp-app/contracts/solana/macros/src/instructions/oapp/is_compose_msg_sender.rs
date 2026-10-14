//! Code generator for the `is_compose_msg_sender` instruction.

use super::CodegenContext;
use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::IsComposeMsgSenderParams)),
        return_type: quote!(bool),
        is_view: true,
        default_impl: Some(DefaultImpl {
            handler_ident: format_ident!("apply"),
            generator: generate_default_impl,
        }),
    }
}

fn generate_default_impl(
    ctx: &CodegenContext,
    spec: &InstructionSpec<CodegenContext>,
) -> DefaultAccounts {
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;
    let params_type = spec.params_type.as_ref().unwrap();
    let return_type = &spec.return_type;
    let oapp_type = &ctx.oapp_type;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdIsComposeMsgSender<'info> {
                pub oapp: Account<'info, #oapp_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdIsComposeMsgSender<'_> {
                pub fn #handler_ident(ctx: &Context<Self>, params: &#params_type) -> Result<#return_type> {
                    Ok(params.compose_sender == ctx.accounts.oapp.key())
                }
            }
        },
    }
}
