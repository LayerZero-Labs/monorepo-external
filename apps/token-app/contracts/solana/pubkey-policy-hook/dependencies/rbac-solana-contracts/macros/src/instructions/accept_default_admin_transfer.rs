//! Code generator for the `accept_default_admin_transfer` instruction.

use anchor_trait::{DefaultAccounts, DefaultImpl, InstructionSpec};
use quote::{format_ident, quote};
use syn::parse_quote;

use super::CodegenContext;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: None,
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
    let return_type = &spec.return_type;
    let state_type = &ctx.state_type;
    let role_type = &ctx.role_type;

    let default_admin_role = quote!(#role_type::default_admin_role());
    let default_admin_role_seed = quote!(&::rbac::traits::RoleType::seed(&#default_admin_role));

    DefaultAccounts {
        struct_type: parse_quote! {
            #[event_cpi]
            #[derive(Accounts)]
            pub struct StdAcceptDefaultAdminTransfer<'info> {
                /// The new admin accepting the transfer.
                #[account(
                    address = *default_admin.pending_default_admin() @ ::rbac::RbacError::CallerNotPendingAdmin
                )]
                pub authority: Signer<'info>,

                #[account(mut)]
                pub payer: Signer<'info>,

                #[account(mut)]
                pub default_admin: Account<'info, #state_type>,

                /// The old admin's DefaultAdmin RoleMember PDA — closed atomically.
                #[account(
                    mut,
                    close = payer,
                    seeds = [
                        ::rbac::ROLE_MEMBER_SEED,
                        default_admin.key().as_ref(),
                        #default_admin_role_seed,
                        default_admin.current_default_admin().as_ref(),
                    ],
                    bump = old_admin_role_member.bump,
                    constraint = old_admin_role_member.role == #default_admin_role
                        @ ::rbac::RbacError::Unauthorized,
                )]
                pub old_admin_role_member: Account<'info, RoleMember>,

                /// The new admin's DefaultAdmin RoleMember PDA — created atomically.
                #[account(
                    init,
                    payer = payer,
                    space = 8 + RoleMember::INIT_SPACE,
                    seeds = [
                        ::rbac::ROLE_MEMBER_SEED,
                        default_admin.key().as_ref(),
                        #default_admin_role_seed,
                        authority.key().as_ref(),
                    ],
                    bump,
                )]
                pub new_admin_role_member: Account<'info, RoleMember>,

                pub system_program: Program<'info, System>,
            }
        },
        impl_block: parse_quote! {
            impl StdAcceptDefaultAdminTransfer<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>) -> Result<#return_type> {
                    let old_admin = *ctx.accounts.default_admin.current_default_admin();
                    ctx.accounts.default_admin.set_current_default_admin(ctx.accounts.authority.key());
                    ctx.accounts.default_admin.set_pending_default_admin(Pubkey::default());

                    ctx.accounts.new_admin_role_member.set_inner(RoleMember {
                        state: ctx.accounts.default_admin.key(),
                        role: #default_admin_role,
                        account: ctx.accounts.authority.key(),
                        bump: ctx.bumps.new_admin_role_member,
                    });

                    emit_cpi!(::rbac::events::RoleRevoked {
                        state: ctx.accounts.default_admin.key(),
                        role: u8::from(#default_admin_role),
                        account: old_admin,
                        sender: ctx.accounts.authority.key(),
                    });
                    emit_cpi!(::rbac::events::RoleGranted {
                        state: ctx.accounts.default_admin.key(),
                        role: u8::from(#default_admin_role),
                        account: ctx.accounts.authority.key(),
                        sender: ctx.accounts.authority.key(),
                    });
                    Ok(())
                }
            }
        },
    }
}
