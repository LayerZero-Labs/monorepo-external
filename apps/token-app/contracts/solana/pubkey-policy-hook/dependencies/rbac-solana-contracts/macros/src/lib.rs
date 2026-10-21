//! # RBAC Macros
//!
//! Procedural macros for Role-Based Access Control in Anchor programs.
//!
//! ## Quick Start
//!
//! ```ignore
//! #[program]
//! #[rbac(state = OFTStore, role_type = RoleType)]
//! pub mod my_program {
//!     use super::*;
//!     // grant_role, revoke_role, renounce_role, begin_default_admin_transfer,
//!     // accept_default_admin_transfer are auto-generated if not defined
//! }
//! ```
//!
//! The generated code assumes `anchor_lang::prelude::*`, `rbac::ROLE_MEMBER_SEED`,
//! and your `RoleMember`/`RoleType` definitions are in scope.

mod init_default_admin;
mod instructions;
mod only_role;
mod rbac;
mod role_type;
mod setup_default_admin;
mod state_types;
mod utils;

use proc_macro::TokenStream;

/// Auto-generates RBAC instructions for a `#[program]` module.
///
/// Generates `grant_role`, `revoke_role`, `renounce_role`, `begin_default_admin_transfer`,
/// and `accept_default_admin_transfer` for any not already defined. Corresponding `Default*`
/// Accounts structs are generated outside the module.
///
/// ## Attributes
///
/// - `state`: The program state type (must impl `DefaultAdmin`)
/// - `role_type`: The RoleType enum
///
/// **Note:** `DefaultAdmin` initialization is NOT auto-generated — call
/// `rbac::setup_default_admin!` from your own `initialize` instruction.
#[proc_macro_attribute]
pub fn rbac(attr: TokenStream, item: TokenStream) -> TokenStream {
    rbac::expand(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Marks a function as a custom override for a default RBAC instruction handler.
///
/// The instruction name is inferred from the function name. Supported:
/// `grant_role`, `revoke_role`, `renounce_role`, `begin_default_admin_transfer`,
/// `accept_default_admin_transfer`.
///
/// The body of this stub is unreachable: `#[rbac]` consumes the enclosing
/// module token stream and strips this marker before rustc sees it.
/// Override logic lives in `rbac::expand`.
#[proc_macro_attribute]
pub fn rbac_instruction(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

/// Injects an `admin_role_member` init account into an Initialize context struct.
///
/// ## Usage
///
/// ```ignore
/// #[init_default_admin(state = state, role_type = ExampleRoleType, payer = authority, admin = authority.key())]
/// #[derive(Accounts)]
/// pub struct Initialize<'info> {
///     #[account(mut)]
///     pub authority: Signer<'info>,
///     #[account(init, payer = authority, space = 8 + MyState::INIT_SPACE, seeds = [MY_SEED], bump)]
///     pub state: Account<'info, MyState>,
///     pub system_program: Program<'info, System>,
/// }
/// ```
///
/// ## Attributes
///
/// - `state`: Field name of the state account (PDA scope)
/// - `role_type`: The RoleType enum
/// - `payer`: Account that funds `admin_role_member` creation
/// - `admin`: Expression evaluating to a `Pubkey` (e.g., `authority.key()` or `params.admin`)
///
/// Call `rbac::setup_default_admin!` in the handler after account creation.
#[proc_macro_attribute]
pub fn init_default_admin(attr: TokenStream, item: TokenStream) -> TokenStream {
    init_default_admin::init_default_admin_impl(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Injects a `role_member` PDA constraint to verify an authority has a specific role.
///
/// ## Usage
///
/// ```ignore
/// #[::rbac_macros::only_role(role = RoleType::RateLimiterAdmin, state = oft_store, authority = authority)]
/// #[derive(Accounts)]
/// pub struct CreateRateLimitExemption<'info> {
///     pub authority: Signer<'info>,
///     pub oft_store: Account<'info, OFTStore>,
///     // `role_member` field is auto-injected
/// }
/// ```
///
/// ## Attributes
///
/// - `role`: The role variant to check (e.g., `RoleType::RateLimiterAdmin`)
/// - `state`: Field name of the state account (PDA scope)
/// - `authority`: Field name of the signer
#[proc_macro_attribute]
pub fn only_role(attr: TokenStream, item: TokenStream) -> TokenStream {
    only_role::only_role_impl(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Derives `RoleType` trait for an enum. Emits a minimal impl relying on trait
/// defaults; override methods manually for custom role hierarchy.
///
/// The enum must be `#[repr(u8)]` with a `#[default]` variant.
#[proc_macro_derive(RoleType)]
pub fn role_type_derive(input: TokenStream) -> TokenStream {
    role_type::role_type_derive_impl(input.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Derives `DefaultAdmin` trait for a struct.
///
/// The struct must have `current_default_admin: Pubkey` and
/// `pending_default_admin: Pubkey` fields.
#[proc_macro_derive(DefaultAdmin)]
pub fn default_admin_derive(input: TokenStream) -> TokenStream {
    state_types::generate_default_admin_derive(input.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Sets up the DefaultAdmin state, first RoleMember account, and emits a
/// `RoleGranted` CPI event.
///
/// Call this in your `initialize` handler after the accounts struct has been
/// annotated with `#[init_default_admin]` and `#[event_cpi]`.
///
/// ## Usage
///
/// ```ignore
/// // From an account field:
/// rbac::setup_default_admin!(ctx, state, ctx.accounts.delegate.key(), ExampleRoleType, payer);
/// // From instruction params:
/// rbac::setup_default_admin!(ctx, oft_store, params.admin, ExampleRoleType, payer);
/// ```
///
/// ## Why a proc macro?
///
/// `emit_cpi!` is a proc macro that hardcodes `ctx`. In a `macro_rules!` context,
/// `ctx` would resolve at the definition site (rbac crate) instead of the call
/// site. As a proc macro, all generated tokens use `Span::call_site()`, so `ctx`
/// resolves at the caller's scope where it exists.
#[proc_macro]
pub fn setup_default_admin(input: TokenStream) -> TokenStream {
    setup_default_admin::setup_default_admin_impl(input.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}
