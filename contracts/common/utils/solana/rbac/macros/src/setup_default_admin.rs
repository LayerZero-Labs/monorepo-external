//! Implementation of the `setup_default_admin!` function-like proc macro.
//!
//! Initializes the DefaultAdmin state, first RoleMember PDA, and emits a
//! `RoleGranted` CPI event. Must be called in the handler after accounts
//! annotated with `#[init_default_admin]` and `#[event_cpi]`.

use proc_macro2::TokenStream;
use quote::quote;
use syn::{
    parse::{Parse, ParseStream},
    Expr, Ident, Path, Token,
};

/// Parsed arguments: `ctx, state, admin, role_type, sender`
struct SetupArgs {
    /// The handler's context variable (e.g., `ctx`)
    ctx: Ident,
    /// Field name of the state account used as PDA scope (e.g., `oft_store`)
    state: Ident,
    /// Expression evaluating to the admin's `Pubkey` (e.g., `params.admin`)
    admin: Expr,
    /// The RoleType path (e.g., `RoleType`)
    role_type: Path,
    /// Signer account field on the accounts struct (e.g., `payer`).
    sender: Ident,
}

impl Parse for SetupArgs {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        /// Parses `T` then consumes a trailing comma.
        fn next<T: Parse>(input: ParseStream) -> syn::Result<T> {
            let value = input.parse()?;
            input.parse::<Token![,]>()?;
            Ok(value)
        }

        Ok(Self {
            ctx: next(input)?,
            state: next(input)?,
            admin: next(input)?,
            role_type: next(input)?,
            sender: input.parse()?,
        })
    }
}

pub fn setup_default_admin_impl(input: TokenStream) -> syn::Result<TokenStream> {
    let SetupArgs { ctx, state, admin, role_type, sender } = syn::parse2(input)?;

    Ok(quote! {{
        use ::rbac::traits::DefaultAdmin;

        anchor_lang::prelude::require!(
            #ctx.accounts.#sender.to_account_info().is_signer,
            anchor_lang::error::ErrorCode::AccountNotSigner,
        );

        anchor_lang::prelude::require_keys_eq!(
            *#ctx.accounts.#state.current_default_admin(),
            anchor_lang::prelude::Pubkey::default(),
            ::rbac::RbacError::DefaultAdminAlreadyInitialized,
        );

        let admin_pubkey: anchor_lang::prelude::Pubkey = #admin;
        anchor_lang::prelude::require_keys_neq!(
            admin_pubkey,
            anchor_lang::prelude::Pubkey::default(),
            ::rbac::RbacError::InvalidDefaultAdmin,
        );

        // Enforce that the admin expression here matches the one used as a seed
        // in `#[init_default_admin(admin = ...)]`. Anchor already derived the
        // `admin_role_member` PDA from that attribute's expression; re-derive
        // from `admin_pubkey` with the known bump and reject any mismatch.
        let __rbac_expected_admin_pda = anchor_lang::prelude::Pubkey::create_program_address(
            &[
                ::rbac::ROLE_MEMBER_SEED,
                #ctx.accounts.#state.key().as_ref(),
                &::rbac::traits::RoleType::seed(
                    &<#role_type as ::rbac::traits::RoleType>::default_admin_role(),
                ),
                admin_pubkey.as_ref(),
                &[#ctx.bumps.admin_role_member],
            ],
            #ctx.program_id,
        )
        .map_err(|_| anchor_lang::error!(::rbac::RbacError::InvalidDefaultAdmin))?;
        anchor_lang::prelude::require_keys_eq!(
            __rbac_expected_admin_pda,
            #ctx.accounts.admin_role_member.key(),
            ::rbac::RbacError::InvalidDefaultAdmin,
        );

        #ctx.accounts.#state.set_current_default_admin(admin_pubkey);
        #ctx.accounts
            .#state
            .set_pending_default_admin(anchor_lang::prelude::Pubkey::default());

        #ctx.accounts.admin_role_member.set_inner(RoleMember {
            state: #ctx.accounts.#state.key(),
            role: <#role_type as ::rbac::traits::RoleType>::default_admin_role(),
            account: admin_pubkey,
            bump: #ctx.bumps.admin_role_member,
        });

        emit_cpi!(::rbac::events::RoleGranted {
            state: #ctx.accounts.#state.key(),
            role: <#role_type as ::rbac::traits::RoleType>::default_admin_role().into(),
            account: admin_pubkey,
            sender: #ctx.accounts.#sender.key(),
        });
    }})
}
