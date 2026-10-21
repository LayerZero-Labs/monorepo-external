//! Code generator for the `get_default_admin` instruction.

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
        return_type: quote!(::rbac::types::DefaultAdminInfo),
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
    let return_type = &spec.return_type;
    let state_type = &ctx.state_type;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[derive(Accounts)]
            pub struct StdGetDefaultAdmin<'info> {
                pub default_admin: Account<'info, #state_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdGetDefaultAdmin<'_> {
                pub fn #handler_ident(ctx: &Context<Self>) -> Result<#return_type> {
                    Ok(::rbac::types::DefaultAdminInfo {
                        current: *ctx.accounts.default_admin.current_default_admin(),
                        pending: *ctx.accounts.default_admin.pending_default_admin(),
                    })
                }
            }
        },
    }
}
