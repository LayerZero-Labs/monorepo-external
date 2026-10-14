//! Code generator for the `next_nonce` instruction.

use super::CodegenContext;
use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::NextNonceParams)),
        return_type: quote!(u64),
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
            #[instruction(params: #params_type)]
            pub struct StdNextNonce<'info> {
                pub oapp: Account<'info, #oapp_type>,

                #[account(
                    seeds = [::oapp::NONCE_SEED, oapp.key().as_ref(), &params.src_eid.to_be_bytes(), &params.sender],
                    bump,
                    seeds::program = ::oapp::endpoint::ID
                )]
                pub nonce_account: UncheckedAccount<'info>,
            }
        },
        impl_block: parse_quote! {
            impl StdNextNonce<'_> {
                pub fn #handler_ident(ctx: &Context<Self>, _params: &#params_type) -> Result<#return_type> {
                    // path nonce starts from 1. if 0 it means that there is no specific nonce enforcement
                    return Ok(0);
                }
            }
        },
    }
}
