//! Implementation of the `#[::rbac_macros::only_role]` attribute macro.
//!
//! This macro adds a role member PDA constraint to verify an authority has a specific role.

use darling::{ast::NestedMeta, FromMeta};
use proc_macro2::TokenStream;
use quote::quote;
use syn::{parse::Parser, Field, Ident, ItemStruct};

use crate::utils::{self, ExprArg};

/// Parsed attributes for the only_role macro.
#[derive(FromMeta)]
pub struct OnlyRoleAttr {
    /// The role to check - supports both static (`RoleType::Admin`) and dynamic (`params.role`)
    pub role: ExprArg,
    /// The field name of the state account used as PDA scope (e.g., `oapp`)
    pub state: Ident,
    /// The field name of the authority/signer
    pub authority: Ident,
}

pub fn only_role_impl(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let attr_args = NestedMeta::parse_meta_list(attr)?;
    let attrs = OnlyRoleAttr::from_list(&attr_args)?;
    let mut accounts_struct: ItemStruct = syn::parse2(item)?;

    let role = &attrs.role.0; // unwrap the Expr
    let state_field = &attrs.state;
    let authority_field = &attrs.authority;

    let fields = utils::named_fields_mut(&mut accounts_struct)?;
    let new_field = Field::parse_named.parse2(quote! {
        /// Role membership proof — authority must have the required role.
        #[account(
            seeds = [
                ::rbac::ROLE_MEMBER_SEED,
                #state_field.key().as_ref(),
                &::rbac::traits::RoleType::seed(&(#role)),
                #authority_field.key().as_ref(),
            ],
            bump = role_member.bump,
            constraint = #authority_field.is_signer @ ::rbac::RbacError::Unauthorized,
            constraint = role_member.role == (#role) @ ::rbac::RbacError::Unauthorized,
        )]
        pub role_member: Account<'info, RoleMember>
    })?;
    fields.named.push(new_field);

    Ok(quote!(#accounts_struct))
}
