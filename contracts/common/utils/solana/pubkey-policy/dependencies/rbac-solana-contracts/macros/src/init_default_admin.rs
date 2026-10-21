//! Implementation of the `#[init_default_admin]` attribute macro.
//!
//! Injects the `admin_role_member` init account into a user-defined Initialize
//! context struct. Admin state fields (current/pending admin) are stored directly
//! in the program's root state account via the `DefaultAdmin` trait.

use darling::{ast::NestedMeta, FromMeta};
use proc_macro2::TokenStream;
use quote::quote;
use syn::{parse::Parser, Field, Ident, ItemStruct, Path};

use crate::utils::{self, ExprArg};

/// Parsed attributes for the init_default_admin macro.
#[derive(FromMeta)]
pub struct InitAdminAttr {
    /// The field name of the state account used as PDA scope (e.g., `state`)
    pub state: Ident,
    /// The RoleType path (e.g., `ExampleRoleType`)
    pub role_type: Path,
    /// The account that funds `admin_role_member` creation
    pub payer: Ident,
    /// Expression that evaluates to a Pubkey for the initial DefaultAdmin role.
    /// Supports account fields (`delegate.key()`) and params (`params.admin`).
    pub admin: ExprArg,
}

/// Parse `#[init_default_admin(...)]` attributes, then inject the `admin_role_member`
/// init account and an `init_default_admin` helper into the target struct.
///
/// `payer` funds the account creation, while `admin` receives the initial
/// DefaultAdmin role.
pub fn init_default_admin_impl(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let attr_args = NestedMeta::parse_meta_list(attr)?;
    let attrs = InitAdminAttr::from_list(&attr_args)?;
    let mut accounts_struct: ItemStruct = syn::parse2(item)?;

    let state_field = attrs.state;
    let role_type = attrs.role_type;
    let payer_field = attrs.payer;
    let admin_expr = &attrs.admin.0;

    let default_admin_role = quote!(<#role_type as ::rbac::traits::RoleType>::default_admin_role());
    let default_admin_role_seed = quote!(&::rbac::traits::RoleType::seed(&#default_admin_role));

    let fields = utils::named_fields_mut(&mut accounts_struct)?;
    let new_field: Field = Field::parse_named.parse2(quote! {
        /// First DefaultAdmin RoleMember PDA.
        #[account(
            init,
            payer = #payer_field,
            space = 8 + RoleMember::INIT_SPACE,
            seeds = [
                ::rbac::ROLE_MEMBER_SEED,
                #state_field.key().as_ref(),
                #default_admin_role_seed,
                (#admin_expr).as_ref(),
            ],
            bump,
        )]
        pub admin_role_member: Account<'info, RoleMember>
    })?;
    fields.named.push(new_field);

    // Inject #[event_cpi] so that setup_default_admin! can emit CPI events.
    // Strip any existing one to avoid duplication.
    accounts_struct.attrs.retain(|attr| !attr.path().is_ident("event_cpi"));

    Ok(quote! {
        #[event_cpi]
        #accounts_struct
    })
}
