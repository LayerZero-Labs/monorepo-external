//! Code generator for the messaging-channel `nilify` instruction.
//!
//! Temporarily blocks execution until re-verification.
//! Requires [`MessagingChannelRoles::message_nilifier_role`]. The Endpoint accounts are passed as
//! remaining accounts in `oapp::endpoint_cpi::nilify` order.

use super::CodegenContext;
use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::NilifyParams)),
        return_type: quote!(()),
        is_view: false,
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
    let role_type = &ctx.role_type;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[::rbac::only_role(
                role = #role_type::message_nilifier_role(),
                state = oapp,
                authority = authority
            )]
            #[derive(Accounts)]
            pub struct StdNilify<'info> {
                pub authority: Signer<'info>,

                pub oapp: Account<'info, #oapp_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdNilify<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<#return_type> {
                    let receiver = ctx.accounts.oapp.key();
                    ::oapp::endpoint_cpi::nilify(
                        ::oapp::endpoint::ID,
                        receiver,
                        ctx.remaining_accounts,
                        &ctx.accounts.oapp.signer_seeds(),
                        ::oapp::endpoint::types::NilifyParams {
                            receiver,
                            src_eid: params.src_eid,
                            sender: params.sender,
                            nonce: params.nonce,
                            payload_hash: params.payload_hash,
                        },
                    )
                }
            }
        },
    }
}
