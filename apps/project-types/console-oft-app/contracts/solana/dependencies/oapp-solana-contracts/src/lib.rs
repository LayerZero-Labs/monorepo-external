//! LayerZero OApp SDK for Solana.
//!
//! Provides the core building blocks for Solana programs that integrate with the
//! LayerZero V2 cross-chain messaging protocol as an Omnichain Application (OApp).
//!
//! # What's included
//!
//! - **PDA seeds** – canonical constants for deriving all protocol-related accounts (peers,
//!   enforced options, nonces, payload hashes, etc.).
//! - **Endpoint CPI helpers** – thin wrappers around cross-program invocations to the LayerZero
//!   Endpoint program (send, quote, compose, etc.).
//! - **Account macros** – re-exported from [`oapp_macros`] to generate boilerplate Anchor account
//!   structs for standard OApp instructions.
//! - **Types & traits** – shared parameter / return structs, the [`OAppState`] trait for PDA signer
//!   seeds, [`MessagingChannelRoles`] for messaging-channel RBAC, and messaging option builders.
//! - **Receive / compose planning** – plan formats ([`lz_receive_types_v3`],
//!   [`lz_compose_types_v3`]) and the [`lz_plan`] output writer.

pub mod common;
pub mod endpoint_cpi;
pub mod events;
pub mod lz_compose_types_v3;
pub mod lz_plan;
pub mod lz_receive_types_v3;
pub mod oapp_info;
pub mod options;
pub mod types;
pub mod utils;

mod errors;
use anchor_lang::prelude::*;
// `idls/endpoint.json` is vendored here because `declare_program!` reads the
// IDL at compile time, and downstream consumers of this crate cannot rely on
// a workspace-relative path to the Endpoint program's own build output.
declare_program!(endpoint);

pub use errors::*;

// Re-export procedural macros so consumers can `use oapp::oapp`
pub use oapp_macros::*;

// OApp state & config
pub const OAPP_SEED: &[u8] = b"OApp";
pub const OAPP_INFO_SEED: &[u8] = b"OAppInfo";
pub const PEER_SEED: &[u8] = b"Peer";
pub const ENFORCED_OPTIONS_SEED: &[u8] = b"EnforcedOptions";

// Messaging
pub const LZ_COMPOSE_TYPES_SEED: &[u8] = b"LzComposeTypes";
pub const LZ_RECEIVE_TYPES_SEED: &[u8] = b"LzReceiveTypes";
pub const NONCE_SEED: &[u8] = b"Nonce";
pub const PENDING_NONCE_SEED: &[u8] = b"PendingNonce";
pub const PAYLOAD_HASH_SEED: &[u8] = b"PayloadHash";
pub const COMPOSED_MESSAGE_HASH_SEED: &[u8] = b"ComposedMessageHash";

// Endpoint & library config
pub const ENDPOINT_SEED: &[u8] = b"Endpoint";
pub const MESSAGE_LIB_SEED: &[u8] = b"MessageLib";
pub const SEND_LIBRARY_CONFIG_SEED: &[u8] = b"SendLibraryConfig";
pub const RECEIVE_LIBRARY_CONFIG_SEED: &[u8] = b"ReceiveLibraryConfig";

// Event
pub const EVENT_SEED: &[u8] = b"__event_authority";

/// PDA seeds for an OApp's `lz_receive_types_accounts` PDA: `[LZ_RECEIVE_TYPES_SEED, oapp_key]`.
///
/// Uses `Box::leak` to produce the `'static` shape Anchor's `#[account(seeds = ...)]` requires,
/// leaking ~64 bytes per call. **SVM-only**: on-chain the leak lives only as long as the program's
/// VM heap. Do not call this from long-running off-chain Rust (native test runners, indexers,
/// CLIs); derive the PDA with stack-local seeds there.
pub fn lz_receive_types_seeds(oapp_key: &Pubkey) -> &'static [&'static [u8]] {
    let key_bytes: &'static [u8; 32] = Box::leak(Box::new(oapp_key.to_bytes()));
    Box::leak(Box::new([LZ_RECEIVE_TYPES_SEED, key_bytes.as_slice()]))
}

/// Trait for OApp state types.
///
/// Defines the minimal interface for PDA signer seeds used in CPI invocations.
/// `N` is the number of seed segments (e.g. 3 for `[PREFIX, key, bump]`).
pub trait OAppState<const N: usize> {
    fn signer_seeds(&self) -> [&[u8]; N];
}

/// Roles gating the `#[oapp]`-generated messaging-channel instructions; the program's role enum
/// must implement this.
///
/// The DefaultAdmin does not need them: it is the OApp's Endpoint delegate and can clear, skip,
/// burn and nilify on the Endpoint directly. These roles let other keys do the same through the
/// OApp. The two are meant to be distinct roles, which the framework does not check.
pub trait MessagingChannelRoles {
    /// Role for `clear`, `skip`, and `burn`.
    fn messaging_channel_manager_role() -> Self;

    /// Role for `nilify`.
    fn message_nilifier_role() -> Self;
}
