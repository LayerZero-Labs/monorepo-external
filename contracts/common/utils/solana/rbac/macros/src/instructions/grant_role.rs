//! Code generator for the `grant_role` instruction.

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec(ctx: &CodegenContext) -> InstructionSpec<CodegenContext> {
    let role_type = &ctx.role_type;
    InstructionSpec {
        params_type: Some(quote!(::rbac::types::GrantRoleParams<#role_type>)),
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
            pub struct StdGrantRole<'info> {
                /// The authority who is granting the role. Must have role admin privileges.
                pub authority: Signer<'info>,

                #[account(mut)]
                pub payer: Signer<'info>,

                /// Program state implementing `DefaultAdmin`. Used here only as PDA
                /// scope for role-member derivation.
                pub default_admin: Account<'info, #state_type>,

                /// Proves the authority holds the role admin for the role being granted.
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

                /// The role member account to create for the grantee.
                #[account(
                    init,
                    payer = payer,
                    space = 8 + RoleMember::INIT_SPACE,
                    seeds = [
                        ::rbac::ROLE_MEMBER_SEED,
                        default_admin.key().as_ref(),
                        #role_member_seed,
                        params.account.as_ref(),
                    ],
                    bump
                )]
                pub role_member: Account<'info, RoleMember>,

                pub system_program: Program<'info, System>,
            }
        },
        impl_block: parse_quote! {
            impl StdGrantRole<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<#return_type> {
                    require!(
                        !#role_type::is_default_admin(&params.role),
                        ::rbac::RbacError::DefaultAdminNotGrantable
                    );

                    ctx.accounts.role_member.set_inner(RoleMember {
                        state: ctx.accounts.default_admin.key(),
                        role: params.role,
                        account: params.account,
                        bump: ctx.bumps.role_member,
                    });

                    emit_cpi!(::rbac::events::RoleGranted {
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
