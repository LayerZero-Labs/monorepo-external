//! Standard LayerZero OApp types.
//!
//! Canonical parameter and return structs for OApp instructions that match
//! the LayerZero protocol interface. They don't change between implementations.

use anchor_lang::prelude::*;

/// Params for the `set_peer` instruction.
///
/// Configures a trusted remote peer address for a specific chain, enabling
/// cross-chain communication.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetPeerParams {
    /// The endpoint ID of the remote chain (e.g., Ethereum mainnet, Arbitrum).
    pub eid: u32,
    /// The 32-byte address of the trusted peer on the remote chain.
    pub peer: [u8; 32],
}

/// Params for the `set_enforced_options` instruction.
///
/// Sets mandatory execution options (e.g., gas limits)
/// for a specific message type to a specific destination chain.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetEnforcedOptionsParams {
    /// The endpoint ID of the destination chain.
    pub eid: u32,
    /// The message type identifier (oapp-defined).
    pub msg_type: u16,
    /// The encoded execution options to enforce for this destination/message type pair.
    pub options: Vec<u8>,
}

/// Params for the `get_enforced_options` instruction (read-only view method).
///
/// Queries the stored enforced options for a given destination chain and
/// message type.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GetEnforcedOptionsParams {
    /// The endpoint ID of the destination chain to query.
    pub eid: u32,
    /// The message type identifier to query.
    pub msg_type: u16,
}

/// Params for the `lz_receive` instruction.
///
/// Delivered by the LayerZero executor after message verification is complete.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LzReceiveParams {
    /// The endpoint ID of the source chain that sent the message.
    pub src_eid: u32,
    /// The 32-byte address of the sender on the source chain.
    pub sender: [u8; 32],
    /// The message sequence number.
    pub nonce: u64,
    /// The globally unique identifier for this cross-chain message.
    pub guid: [u8; 32],
    /// The encoded message payload (oapp-defined).
    pub message: Vec<u8>,
    /// Additional executor-provided data for the receive transaction.
    pub extra_data: Vec<u8>,
}

/// Params for the `lz_compose` instruction.
///
/// Enables multi-step cross-chain execution (the compose flow).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LzComposeParams {
    /// The OApp receiver address that sent the compose message.
    pub from: Pubkey,
    /// The composer address that will receive the message.
    pub to: Pubkey,
    /// The globally unique identifier of the original cross-chain message.
    pub guid: [u8; 32],
    /// The index of this composed message (supports multiple composes per message).
    pub index: u16,
    /// The encoded composed message payload.
    pub message: Vec<u8>,
    /// Additional executor-provided data for the compose transaction.
    pub extra_data: Vec<u8>,
}

/// Params for the `next_nonce` instruction (read-only view method).
///
/// Queries the next expected nonce for ordered message delivery from a
/// specific source chain and sender. The default implementation returns 0
/// (no ordering enforcement); OApps can override to enforce sequencing.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct NextNonceParams {
    /// The endpoint ID of the source chain.
    pub src_eid: u32,
    /// The 32-byte address of the remote sender.
    pub sender: [u8; 32],
}

/// Params for the `is_compose_msg_sender` instruction (read-only view method).
///
/// Validates whether an account is authorized to send composed messages for a
/// given cross-chain message. The default implementation only permits the OApp
/// itself; OApps can override for custom authorization logic. Returns `bool`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct IsComposeMsgSenderParams {
    /// The endpoint ID of the source chain.
    pub src_eid: u32,
    /// The 32-byte address of the remote sender.
    pub sender: [u8; 32],
    /// The message sequence number.
    pub nonce: u64,
    /// The encoded message payload for context.
    pub message: Vec<u8>,
    /// The account claiming authorization to send the compose message.
    pub compose_sender: Pubkey,
}

/// Params for the OApp `clear` instruction (messaging-channel manager).
///
/// `receiver` is intentionally omitted — the handler injects the OApp PDA.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClearParams {
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub guid: [u8; 32],
    pub message: Vec<u8>,
}

/// Params for the OApp `skip` instruction (messaging-channel manager).
///
/// `receiver` is intentionally omitted — the handler injects the OApp PDA.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SkipParams {
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
}

/// Params for the OApp `burn` instruction (messaging-channel manager).
///
/// `receiver` is intentionally omitted — the handler injects the OApp PDA.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BurnParams {
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub payload_hash: [u8; 32],
}

/// Params for the OApp `nilify` instruction (message nilifier).
///
/// `receiver` is intentionally omitted — the handler injects the OApp PDA.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct NilifyParams {
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub payload_hash: [u8; 32],
}
