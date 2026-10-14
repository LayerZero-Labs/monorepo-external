//! Code generator for the `init_enforced_options` instruction.
//!
//! Creates the EnforcedOptions PDA at the correct size for the initial options buffer.
//! Subsequent updates (including resize) use `set_enforced_options`.

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
            pub struct StdInitEnforcedOptions<'info> {
                pub authority: Signer<'info>,

                #[account(mut)]
                pub payer: Signer<'info>,

                pub oapp: Account<'info, #oapp_type>,

                #[account(
                    init,
                    payer = payer,
                    space = EnforcedOptions::space(params.options.len()),
                    seeds = [
                        ::oapp::ENFORCED_OPTIONS_SEED,
                        oapp.key().as_ref(),
                        &params.eid.to_be_bytes(),
                        &params.msg_type.to_be_bytes(),
                    ],
                    bump
                )]
                pub enforced_options: Account<'info, EnforcedOptions>,

                pub system_program: Program<'info, System>,
            }
        },
        impl_block: parse_quote! {
            impl StdInitEnforcedOptions<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<#return_type> {
                    if !params.options.is_empty() {
                        ::oapp::options::assert_type_3(&params.options)?;
                    }

                    let enforced_options = &mut ctx.accounts.enforced_options;
                    enforced_options.options = params.options.clone();
                    enforced_options.bump = ctx.bumps.enforced_options;

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
