//! # RBAC - Role-Based Access Control for Anchor Programs
//!
//! A reusable crate for implementing RBAC patterns in Solana Anchor programs,
//! aligned with OpenZeppelin's AccessControl pattern from EVM.
//!
//! ## Features
//!
//! - **Derive macro**: `#[derive(RoleType)]` auto-implements `RoleType`
//! - **Attribute macros**: `#[rbac]`, `#[only_role]`, `#[init_default_admin]`
//! - **Reusable types**: Generic GrantRoleParams, RevokeRoleParams, RenounceRoleParams,
//!   DefaultAdminInfo
//! - **Auto-generated events**: `#[rbac]` generates
//!   RoleGranted/RoleRevoked/DefaultAdminTransferStarted events
//! - **RPC enumeration**: `RoleMember` stores its state at offset 8 and role at offset 40, so
//!   `getProgramAccounts` can filter on both
//!
//! ## Quick Start
//!
//! 1. Define your role enum with `#[derive(RoleType)]`. Pin the `#[default]` variant to
//!    discriminant `0`.
//! 2. Define your program state and `#[derive(DefaultAdmin)]` (or implement
//!    [`traits::DefaultAdmin`] manually).
//! 3. Apply `#[rbac(state = ..., role_type = ...)]` to your `#[program]` module — the macro
//!    generates `grant_role`, `revoke_role`, `renounce_role`, `begin_default_admin_transfer`,
//!    `accept_default_admin_transfer`, and `get_default_admin` for any not already defined.
//! 4. In your own `initialize` instruction, annotate the accounts struct with
//!    `#[init_default_admin(...)]` and call `setup_default_admin!` in the handler.
//! 5. Gate any custom role-protected instruction by adding `#[only_role(role = ..., state = ...,
//!    authority = ...)]` to its accounts struct.
//!
//! See [`README.md`](../README.md) for the full API reference.
//!
//! ## Example
//!
//! ```ignore
//! use anchor_lang::prelude::*;
//!
//! #[derive(
//!     Clone, Copy, PartialEq, Eq,
//!     AnchorSerialize, AnchorDeserialize, InitSpace, Default,
//!     num_enum::TryFromPrimitive, num_enum::IntoPrimitive,
//!     rbac::RoleType,
//! )]
//! #[repr(u8)]
//! pub enum AppRole {
//!     #[default]
//!     DefaultAdmin = 0,  // discriminant 0 — required for default admin role
//!     Pauser = 1,
//! }
//!
//! #[account]
//! #[derive(InitSpace, rbac::DefaultAdmin)]
//! pub struct AppState {
//!     pub current_default_admin: Pubkey,
//!     pub pending_default_admin: Pubkey,
//! }
//!
//! // Events (RoleGranted, RoleRevoked, DefaultAdminTransferStarted) are
//! // emitted via `emit_cpi!` from the auto-generated handlers.
//! #[program]
//! #[rbac::rbac(state = AppState, role_type = AppRole)]
//! pub mod my_program {
//!     use super::*;
//!     // grant_role, revoke_role, renounce_role,
//!     // begin_default_admin_transfer, accept_default_admin_transfer,
//!     // get_default_admin are auto-generated.
//! }
//! ```

pub mod events;
pub mod traits;
pub mod types;

mod errors;

pub use errors::*;

// Re-export procedural macros
pub use rbac_macros::*;

/// Seed prefix for RoleMember PDAs.
/// Full PDA: [ROLE_MEMBER_SEED, state.key(), role_byte, member]
/// `state.key()` scopes roles per instance (supports multi-instance programs).
pub const ROLE_MEMBER_SEED: &[u8] = b"RoleMember";
