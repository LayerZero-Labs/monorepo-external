//! Code generator for the `set_peer` instruction.

use super::CodegenContext;
use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::SetPeerParams)),
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
            #[::rbac::only_role(role = #role_type::default_admin_role(), state = oapp, authority = authority)]
            #[event_cpi]
            #[derive(Accounts)]
            #[instruction(params: #params_type)]
            pub struct StdSetPeer<'info> {
                pub authority: Signer<'info>,

                #[account(mut)]
                pub payer: Signer<'info>,

                pub oapp: Account<'info, #oapp_type>,

                #[account(
                    init_if_needed,
                    payer = payer,
                    space = 8 + OAppPeer::INIT_SPACE,
                    seeds = [::oapp::PEER_SEED, oapp.key().as_ref(), &params.eid.to_be_bytes()],
                    bump
                )]
                pub peer: Account<'info, OAppPeer>,

                pub system_program: Program<'info, System>,
            }
        },
        impl_block: parse_quote! {
            impl StdSetPeer<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<#return_type> {
                    let peer = &mut ctx.accounts.peer;
                    peer.address = params.peer;
                    peer.bump = ctx.bumps.peer;

                    emit_cpi!(::oapp::events::PeerSet {
                        oapp: ctx.accounts.oapp.key(),
                        eid: params.eid,
                        peer: params.peer,
                    });

                    Ok(())
                }
            }
        },
    }
}
