use anchor_lang::prelude::*;

/// Emitted when a peer is set for a destination endpoint.
///
/// `oapp` is the OApp-store PDA this peer entry belongs to. A single OApp
/// program manages many independent OApp-store instances (mirroring how the
/// SPL Token program manages many `Mint` accounts), so the event carries the
/// store pubkey to let off-chain consumers attribute each change to the right
/// instance.
#[event]
pub struct PeerSet {
    pub oapp: Pubkey,
    pub eid: u32,
    pub peer: [u8; 32],
}

/// Emitted when enforced options are set for a destination endpoint and message type.
///
/// See [`PeerSet`] for the rationale of the `oapp` field.
#[event]
pub struct EnforcedOptionsSet {
    pub oapp: Pubkey,
    pub eid: u32,
    pub msg_type: u16,
    pub options: Vec<u8>,
}
