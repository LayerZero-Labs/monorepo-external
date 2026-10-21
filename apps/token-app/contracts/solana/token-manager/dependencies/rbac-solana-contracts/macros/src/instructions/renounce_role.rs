//! Code generator for the `renounce_role` instruction.

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec(ctx: &CodegenContext) -> InstructionSpec<CodegenContext> {
    let role_type = &ctx.role_type;
    InstructionSpec {
        params_type: Some(quote!(::rbac::types::RenounceRoleParams<#role_type>)),
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
    let role_type = &ctx.role_type;

    DefaultAccounts {
        struct_type: parse_quote! {
            #[event_cpi]
            #[derive(Accounts)]
            #[instruction(params: #params_type)]
            pub struct StdRenounceRole<'info> {
                /// The authority who is renouncing their own role.
                pub authority: Signer<'info>,

                /// CHECK: Only receives lamports from account closure; no further validation needed.
                #[account(mut)]
                pub receiver: UncheckedAccount<'info>,

                /// Program state implementing `DefaultAdmin`. Used here only as PDA
                /// scope for role-member derivation.
                pub default_admin: Account<'info, #state_type>,

                /// The role member account to close.
                /// Must belong to the signer (validated by PDA seeds including authority.key()).
                #[account(
                    mut,
                    close = receiver,
                    seeds = [
                        ::rbac::ROLE_MEMBER_SEED,
                        default_admin.key().as_ref(),
                        &::rbac::traits::RoleType::seed(&params.role),
                        authority.key().as_ref(),
                    ],
                    bump = role_member.bump,
                    constraint = role_member.role == params.role @ ::rbac::RbacError::Unauthorized,
                )]
                pub role_member: Account<'info, RoleMember>,
            }
        },
        impl_block: parse_quote! {
            impl StdRenounceRole<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<#return_type> {
                    require!(
                        !#role_type::is_default_admin(&params.role),
                        ::rbac::RbacError::DefaultAdminNotRenounceable
                    );

                    emit_cpi!(::rbac::events::RoleRevoked {
                        state: ctx.accounts.default_admin.key(),
                        role: params.role.into(),
                        account: ctx.accounts.authority.key(),
                        sender: ctx.accounts.authority.key(),
                    });
                    Ok(())
                }
            }
        },
    }
}
