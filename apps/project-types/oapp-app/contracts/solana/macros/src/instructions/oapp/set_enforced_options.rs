//! Code generator for the `set_enforced_options` instruction.
//!
//! Updates an existing EnforcedOptions PDA, resizing the account if the new
//! options buffer differs in length. The account must already exist (created
//! by `init_enforced_options`).
//!
//! # Rent refund behaviour
//!
//! The generated `StdSetEnforcedOptions` struct exposes a separate `payer` field
//! (distinct from `authority`). When the options buffer shrinks, Anchor's
//! `realloc::payer` directive returns the freed lamports to the **current
//! transaction's `payer`**, not to the account that originally funded the PDA
//! in `init_enforced_options`.
//!
//! This is intentional: the instruction is gated by
//! `#[only_role(default_admin_role)]`, so an authorised admin always controls
//! which account is supplied as `payer`. Integrators should be aware that rent
//! refunds on buffer shrink flow to the call-time `payer`, not the original
//! funder.

use super::CodegenContext;
use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::SetEnforcedOptionsParams)),
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
            pub struct StdSetEnforcedOptions<'info> {
                pub authority: Signer<'info>,

                #[account(mut)]
                pub payer: Signer<'info>,

                pub oapp: Account<'info, #oapp_type>,

                #[account(
                    mut,
                    realloc = EnforcedOptions::space(params.options.len()),
                    realloc::payer = payer,
                    realloc::zero = true,
                    seeds = [
                        ::oapp::ENFORCED_OPTIONS_SEED,
                        oapp.key().as_ref(),
                        &params.eid.to_be_bytes(),
                        &params.msg_type.to_be_bytes(),
                    ],
                    bump = enforced_options.bump,
                )]
                pub enforced_options: Account<'info, EnforcedOptions>,

                pub system_program: Program<'info, System>,
            }
        },
        impl_block: parse_quote! {
            impl StdSetEnforcedOptions<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<#return_type> {
                    if !params.options.is_empty() {
                        ::oapp::options::assert_type_3(&params.options)?;
                    }

                    ctx.accounts.enforced_options.options = params.options.clone();

                    emit_cpi!(::oapp::events::EnforcedOptionsSet {
                        oapp: ctx.accounts.oapp.key(),
                        eid: params.eid,
                        msg_type: params.msg_type,
                        options: params.options.clone(),
                    });

                    Ok(())
                }
            }
        },
    }
}
