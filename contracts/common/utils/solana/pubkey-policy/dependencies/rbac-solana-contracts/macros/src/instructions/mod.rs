//! RBAC instruction definitions and code generation.

mod accept_default_admin_transfer;
mod begin_default_admin_transfer;
mod get_default_admin;
mod grant_role;
mod renounce_role;
mod revoke_role;

use anchor_trait::declare_instructions;
use proc_macro2::TokenStream;

/// Domain-specific context carrying resolved types for RBAC code generation.
pub(crate) struct CodegenContext {
    pub role_type: TokenStream,
    pub state_type: TokenStream,
}

declare_instructions! {
    name    = RbacInstructionSet;
    context = CodegenContext;

    AcceptDefaultAdminTransfer => accept_default_admin_transfer,
    BeginDefaultAdminTransfer  => begin_default_admin_transfer,
    GetDefaultAdmin            => get_default_admin,
    GrantRole                  => grant_role(ctx),
    RevokeRole                 => revoke_role(ctx),
    RenounceRole               => renounce_role(ctx),
}
