//! Generates an RBAC **handler override** for `accept_default_admin_transfer`
//! that also calls `set_delegate`, keeping the endpoint delegate in sync with
//! the new default admin — matching the EVM `OAppCoreRBACUpgradeable` behaviour.
//!
//! This is **not** an OApp instruction. It produces a `#[rbac_instruction]`
//! handler that reuses the RBAC-generated `StdAcceptDefaultAdminTransfer`
//! accounts struct (handler override level), so there is no duplicate struct.
//!
//! # Prerequisites
//!
//! The generated handler calls `endpoint_cpi::set_delegate`, which requires the
//! `OAppRegistry` PDA (seeds `[OAPP_SEED, oapp.key()]`) to already exist.  That
//! PDA is created by `endpoint_cpi::register_oapp` — a step the `#[oapp]` macro
//! neither generates nor enforces.
//!
//! **`register_oapp` is a mandatory call in the OApp's `initialize` handler.**
//! Omitting it means `accept_default_admin_transfer` will always fail once a
//! default-admin transfer is initiated, permanently bricking the admin transfer
//! flow.

use proc_macro2::TokenStream;
use quote::quote;

/// Returns the handler function token stream to be placed inside the module.
///
/// Uses `Context<StdAcceptDefaultAdminTransfer>` so the RBAC macro treats it
/// as a **handler override** — RBAC still generates the accounts struct, but
/// the entrypoint dispatches to this handler instead of the default `apply`.
pub(crate) fn generate() -> TokenStream {
    quote! {
        /// OApp override: accept admin transfer + sync endpoint delegate.
        #[rbac_instruction]
        pub fn accept_default_admin_transfer(ctx: &mut Context<StdAcceptDefaultAdminTransfer>) -> Result<()> {
            StdAcceptDefaultAdminTransfer::apply(ctx)?;

            let seeds = ctx.accounts.default_admin.signer_seeds();
            ::oapp::endpoint_cpi::set_delegate(
                ::oapp::endpoint::ID,
                ctx.accounts.default_admin.key(), // oapp_key
                &ctx.remaining_accounts,
                &seeds,
                ::oapp::endpoint::types::SetDelegateParams {
                    delegate: ctx.accounts.authority.key(),
                },
            )?;

            Ok(())
        }
    }
}
