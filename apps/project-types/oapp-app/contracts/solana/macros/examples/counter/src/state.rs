use anchor_lang::{
    prelude::{account, borsh, AnchorDeserialize, AnchorSerialize, InitSpace, Pubkey},
    Discriminator,
};
use anchor_spl::token_interface::spl_token_metadata_interface::solana_borsh;
use oapp::OAppState;
use rbac::{DefaultAdmin, RoleType};
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::SplBorshVariableLenPack;

pub const COUNTER_SEED: &[u8] = b"Counter";

/// Counter program state.
///
/// Stores the cross-chain message counter and embeds
/// `current_default_admin` / `pending_default_admin` so that
/// `#[derive(DefaultAdmin)]` can generate the `DefaultAdmin` trait impl.
#[account]
#[derive(InitSpace, DefaultAdmin)]
pub struct CounterState {
    /// Incremented by `lz_receive` on each inbound cross-chain message.
    pub count: u64,
    pub bump: u8,
    pub current_default_admin: Pubkey,
    pub pending_default_admin: Pubkey,
}

impl OAppState<2> for CounterState {
    fn signer_seeds(&self) -> [&[u8]; 2] {
        [COUNTER_SEED, std::slice::from_ref(&self.bump)]
    }
}

/// App-layer TLV entry written into the OAppInfo account alongside `OAppBase`.
///
/// Demonstrates how a program adds its own typed metadata as a sibling TLV —
/// no nesting, no Borsh blobs, just a flat entry with its own discriminator.
#[derive(
    Clone, AnchorSerialize, AnchorDeserialize, InitSpace, SplDiscriminate, SplBorshVariableLenPack,
)]
#[discriminator_hash_input("counter::info")]
pub struct CounterInfoEntry {
    /// Incremented when the on-chain layout of this entry changes.
    pub version: u8,
    /// Upper bound on the count value; SDK can refuse messages above this.
    pub max_count: u64,
}

impl CounterInfoEntry {
    pub const VERSION: u8 = 11;

    pub fn new() -> Self {
        Self { version: Self::VERSION, max_count: u64::MAX }
    }
}

/// Role enum for the counter program.
///
/// - `DefaultAdmin` (= 0): root role; administers all other roles and OApp config.
#[derive(
    Clone,
    Copy,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    Default,
    RoleType,
    num_enum::TryFromPrimitive,
    num_enum::IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum CounterRoleType {
    #[default]
    DefaultAdmin = 0,
    MessagingChannelManager = 1,
    MessageNilifier = 2,
}

impl oapp::MessagingChannelRoles for CounterRoleType {
    fn messaging_channel_manager_role() -> Self {
        Self::MessagingChannelManager
    }

    fn message_nilifier_role() -> Self {
        Self::MessageNilifier
    }
}
