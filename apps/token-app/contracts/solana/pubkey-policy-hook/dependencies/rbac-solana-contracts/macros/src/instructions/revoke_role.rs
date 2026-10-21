//! Code generator for the `revoke_role` instruction.

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec(ctx: &CodegenContext) -> InstructionSpec<CodegenContext> {
    let role_type = &ctx.role_type;
    InstructionSpec {
        params_type: Some(quote!(::rbac::types::RevokeRoleParams<#role_type>)),
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

    let role_admin_seed =
        quote!(&::rbac::traits::RoleType::seed(&#role_type::role_admin(&params.role)));
    let role_member_seed = quote!(&::rbac::traits::RoleType::seed(&params.role));

    DefaultAccounts {
        struct_type: parse_quote! {
            #[event_cpi]
            #[derive(Accounts)]
            #[instruction(params: #params_type)]
            pub struct StdRevokeRole<'info> {
                /// The authority who is revoking the role. Must have role admin privileges.
                pub authority: Signer<'info>,

                /// CHECK: Only receives lamports from account closure; no further validation needed.
                #[account(mut)]
                pub receiver: UncheckedAccount<'info>,

                /// Program state implementing `DefaultAdmin`. Used here only as PDA
                /// scope for role-member derivation.
                pub default_admin: Account<'info, #state_type>,

                /// Proves the authority holds the admin role for the role being revoked.
                #[account(
                    seeds = [
                        ::rbac::ROLE_MEMBER_SEED,
                        default_admin.key().as_ref(),
                        #role_admin_seed,
                        authority.key().as_ref(),
                    ],
                    bump = role_admin_member.bump,
                    constraint = role_admin_member.role == #role_type::role_admin(&params.role)
                        @ ::rbac::RbacError::Unauthorized,
                )]
                pub role_admin_member: Account<'info, RoleMember>,

                /// The role member account to close.
                #[account(
                    mut,
                    close = receiver,
                    seeds = [
                        ::rbac::ROLE_MEMBER_SEED,
                        default_admin.key().as_ref(),
                        #role_member_seed,
                        params.account.as_ref(),
                    ],
                    bump = role_member.bump,
                    constraint = role_member.role == params.role @ ::rbac::RbacError::Unauthorized,
                )]
                pub role_member: Account<'info, RoleMember>,
            }
        },
        impl_block: parse_quote! {
            impl StdRevokeRole<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<#return_type> {
                    require!(
                        !#role_type::is_default_admin(&params.role),
                        ::rbac::RbacError::DefaultAdminNotRevocable
                    );

                    emit_cpi!(::rbac::events::RoleRevoked {
                        state: ctx.accounts.default_admin.key(),
                        role: params.role.into(),
                        account: params.account,
                        sender: ctx.accounts.authority.key(),
                    });

                    Ok(())
                }
            }
        },
    }
}
