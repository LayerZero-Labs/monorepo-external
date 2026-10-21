//! Code generator for the `get_peer` instruction.

use super::CodegenContext;
use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(u32)),
        return_type: quote!(Option<[u8; 32]>),
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
            #[instruction(eid: #params_type)]
            pub struct StdGetPeer<'info> {
                pub oapp: Account<'info, #oapp_type>,

                #[account(
                    seeds = [::oapp::PEER_SEED, oapp.key().as_ref(), &eid.to_be_bytes()],
                    bump,
                )]
                pub peer: UncheckedAccount<'info>,
            }
        },
        impl_block: parse_quote! {
            impl StdGetPeer<'_> {
                /// Returns `None` both when the peer PDA is uninitialized and when it
                /// holds the zero address, so callers can rely on `is_some()` as an
                /// existence check.
                pub fn #handler_ident(ctx: &Context<Self>, _eid: &#params_type) -> Result<#return_type> {
                    let peer = ::oapp::utils::try_load_account::<OAppPeer>(&ctx.accounts.peer)?;
                    Ok(peer.and_then(|p| (p.address != [0u8; 32]).then_some(p.address)))
                }
            }
        },
    }
}
