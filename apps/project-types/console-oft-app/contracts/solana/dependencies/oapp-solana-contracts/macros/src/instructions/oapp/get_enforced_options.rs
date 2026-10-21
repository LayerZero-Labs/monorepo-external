//! Code generator for the `get_enforced_options` instruction.

use super::CodegenContext;
use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::GetEnforcedOptionsParams)),
        return_type: quote!(Option<Vec<u8>>),
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
            pub struct StdGetEnforcedOptions<'info> {
                pub oapp: Account<'info, #oapp_type>,

                #[account(
                    seeds = [
                        ::oapp::ENFORCED_OPTIONS_SEED,
                        oapp.key().as_ref(),
                        &params.eid.to_be_bytes(),
                        &params.msg_type.to_be_bytes(),
                    ],
                    bump,
                )]
                pub enforced_options: UncheckedAccount<'info>,
            }
        },
        impl_block: parse_quote! {
            impl StdGetEnforcedOptions<'_> {
                pub fn #handler_ident(ctx: &Context<Self>, _params: &#params_type) -> Result<#return_type> {
                    let eo = ::oapp::utils::try_load_account::<EnforcedOptions>(&ctx.accounts.enforced_options)?;
                    Ok(eo.map(|eo| eo.options))
                }
            }
        },
    }
}
