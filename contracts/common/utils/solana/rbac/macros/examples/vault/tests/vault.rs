//! Mollusk BPF tests for the vault example program.
//!
//! Positive tests (happy-path):
//!   - `initialize`                    — creates VaultState + DefaultAdmin RoleMember in one tx
//!   - `get_default_admin`             — view: returns current/pending admin pubkeys
//!   - `deposit`                       — Depositor-role-gated; increments balance
//!   - `grant_role`                    — DefaultAdmin grants Depositor to a user; emits RoleGranted
//!   - `revoke_role`                   — DefaultAdmin revokes Depositor; closes RoleMember; emits
//!     RoleRevoked
//!   - `renounce_role`                 — user renounces own Depositor; closes RoleMember; emits
//!     RoleRevoked
//!   - `begin_default_admin_transfer`  — current admin stages a transfer; emits
//!     DefaultAdminTransferStarted
//!   - `accept_default_admin_transfer` — pending admin completes transfer; emits RoleRevoked +
//!     RoleGranted
//!
//! Negative tests (rejection):
//!   - `initialize`                    — double-init rejected
//!   - `deposit`                       — rejected when caller lacks Depositor role
//!   - `grant_role`                    — rejected for non-admin, duplicate, or direct DefaultAdmin
//!     grant
//!   - `revoke_role`                   — rejected for non-admin or non-existent role member
//!   - `renounce_role`                 — rejected when renouncing another's role or a non-existent
//!     role
//!   - `begin_default_admin_transfer`  — rejected for non-admin and self-transfer
//!   - `accept_default_admin_transfer` — rejected for wrong signer and when no transfer is in
//!     progress

#[path = "vault/helpers.rs"]
mod helpers;
#[path = "vault/negative.rs"]
mod negative;
#[path = "vault/positive.rs"]
mod positive;
