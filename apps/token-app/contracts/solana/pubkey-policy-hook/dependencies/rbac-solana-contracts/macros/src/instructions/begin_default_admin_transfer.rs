//! Code generator for the `begin_default_admin_transfer` instruction.

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(Pubkey)),
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
    let state_type = &ctx.state_type;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[event_cpi]
            #[derive(Accounts)]
            pub struct StdBeginDefaultAdminTransfer<'info> {
                /// The current default admin initiating the transfer.
                #[account(address = *default_admin.current_default_admin() @ ::rbac::RbacError::Unauthorized)]
                pub authority: Signer<'info>,

                #[account(mut)]
                pub default_admin: Account<'info, #state_type>,
            }
        },
        impl_block: parse_quote! {
            impl StdBeginDefaultAdminTransfer<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, new_admin: &#params_type) -> Result<#return_type> {
                    require!(
                        new_admin != ctx.accounts.default_admin.current_default_admin(),
                        ::rbac::RbacError::NewAdminIsSameAsCurrent
                    );
                    ctx.accounts.default_admin.set_pending_default_admin(*new_admin);
                    emit_cpi!(::rbac::events::DefaultAdminTransferStarted {
                        state: ctx.accounts.default_admin.key(),
                        new_admin: *new_admin,
                    });
                    Ok(())
                }
            }
        },
    }
}
