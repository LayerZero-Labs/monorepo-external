//! Mollusk BPF tests for the counter example program.
//!
//! Positive tests (happy-path):
//!   - `initialize`               — creates CounterState + DefaultAdmin RoleMember in one tx
//!   - `set_peer`                 — DefaultAdmin sets trusted peer; emits PeerSet
//!   - `get_peer`                 — view: returns peer address for a given EID
//!   - `init_enforced_options`    — DefaultAdmin creates EnforcedOptions PDA; emits
//!     EnforcedOptionsSet (both non-empty type-3 and empty options)
//!   - `set_enforced_options`     — DefaultAdmin updates existing options; emits EnforcedOptionsSet
//!     (both non-empty type-3 and empty options)
//!   - `get_enforced_options`     — view: returns stored options
//!   - `next_nonce`               — view: always 0 (no ordering enforcement)
//!   - `is_compose_msg_sender`    — view: true iff compose_sender == oapp.key(), false otherwise
//!
//! Negative tests (rejection):
//!   - `initialize`               — double-init rejected
//!   - `set_peer`                 — rejected when caller lacks DefaultAdmin role
//!   - `init_enforced_options`    — rejected for non-admin, wrong options type, too-short options,
//!     duplicate
//!   - `set_enforced_options`     — rejected for non-admin, wrong options type, too-short options,
//!     or not-yet-initialized PDA
//!
//! RBAC instructions (grant_role, revoke_role, renounce_role, transfer_default_admin) are
//! covered by the vault example tests and not duplicated here.

#[path = "counter/helpers.rs"]
mod helpers;
#[path = "counter/negative.rs"]
mod negative;
#[path = "counter/positive.rs"]
mod positive;
