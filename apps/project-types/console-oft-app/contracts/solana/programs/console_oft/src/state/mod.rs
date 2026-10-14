mod oft;
mod rate_limit;

use crate::seeds::{FEE_SEED, PAUSE_SEED};
use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use rbac::RoleType;

pub use oft::*;
pub use rate_limit::*;

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
    TryFromPrimitive,
    IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum RoleType {
    /// The default admin role. This is the root of all role hierarchies.
    /// Members of this role can grant/revoke any role that has DEFAULT_ADMIN as its role_admin.
    /// Also serves as the OApp manager role (setPeer, setEnforcedOptions, setDelegate,
    /// setFeeDeposit). EVM alignment: AccessControl.DEFAULT_ADMIN_ROLE = 0x00
    #[default]
    DefaultAdmin = 0,

    /// Role for setting fee configurations (setDefaultFeeBps, setFeeBps).
    /// EVM alignment: FeeConfigRBACUpgradeable.FEE_CONFIG_MANAGER_ROLE =
    /// keccak256("FEE_CONFIG_MANAGER_ROLE")
    FeeConfigManager = 1,

    /// Role for pausing the contract.
    /// EVM alignment: PauseByIDRBACUpgradeable.PAUSER_ROLE = keccak256("PAUSER_ROLE")
    Pauser = 2,

    /// Role for unpausing the contract.
    /// EVM alignment: PauseByIDRBACUpgradeable.UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE")
    Unpauser = 3,

    /// Role for setting rate limit configurations.
    /// EVM alignment: RateLimiterRBACUpgradeable.RATE_LIMITER_MANAGER_ROLE =
    /// keccak256("RATE_LIMITER_MANAGER_ROLE")
    RateLimiterManager = 4,

    /// Role for messaging-channel clear / skip / burn.
    /// EVM alignment: MessagingChannelManager
    MessagingChannelManager = 5,

    /// Role for messaging-channel nilify.
    /// EVM alignment: MessageNilifier
    MessageNilifier = 6,
}

impl oapp::MessagingChannelRoles for RoleType {
    fn messaging_channel_manager_role() -> Self {
        Self::MessagingChannelManager
    }

    fn message_nilifier_role() -> Self {
        Self::MessageNilifier
    }
}

// ================================ PDA Accounts ================================

/// Per-EID pause configuration PDA (on-chain storage).
/// PDA seeds: [PAUSE_SEED, oft_store.key(), id.to_u128_be_bytes()] (16-byte big-endian u128)
/// PDA existence means a per-ID override exists; absence means fall back to default_paused.
#[account]
#[derive(Default, InitSpace)]
pub struct PauseConfig {
    /// Whether transfers are paused for this EID.
    pub paused: bool,
}

impl PauseConfig {
    /// PDA seeds for the pause config for a given EID.
    /// Seed shape: [PAUSE_SEED, oft_store_key, id_be_bytes]
    pub fn seeds<I: IntoU128BeBytes>(oft_store: &Pubkey, id: I) -> &'static [&'static [u8]] {
        let key_bytes: &'static [u8; 32] = Box::leak(Box::new(oft_store.to_bytes()));
        let id_bytes: &'static [u8; 16] = Box::leak(Box::new(id.to_u128_be_bytes()));
        Box::leak(Box::new([PAUSE_SEED, key_bytes.as_slice(), id_bytes.as_slice()]))
    }
}

/// Per-EID fee configuration PDA (on-chain storage).
/// PDA seeds: [FEE_SEED, oft_store.key(), id.to_u128_be_bytes()] (16-byte big-endian u128)
/// PDA existence means a per-ID override exists; absence means fall back to default_fee_bps.
#[account]
#[derive(Default, InitSpace)]
pub struct FeeConfig {
    pub fee_bps: u16,
}

impl FeeConfig {
    pub fn seeds<I: IntoU128BeBytes>(oft_store: &Pubkey, id: I) -> &'static [&'static [u8]] {
        let key_bytes: &'static [u8; 32] = Box::leak(Box::new(oft_store.to_bytes()));
        let id_bytes: &'static [u8; 16] = Box::leak(Box::new(id.to_u128_be_bytes()));
        Box::leak(Box::new([FEE_SEED, key_bytes.as_slice(), id_bytes.as_slice()]))
    }
}

// ================================ PDA Seed Convert Trait ================================

/// Canonical 16-byte big-endian u128 encoding for numeric IDs used as PDA seed
/// components (per-EID PDAs: rate limiter, pause, fee). Centralizes the cast +
/// endianness so call sites can't silently diverge.
pub trait IntoU128BeBytes {
    fn to_u128_be_bytes(self) -> [u8; 16];
}

impl IntoU128BeBytes for u32 {
    fn to_u128_be_bytes(self) -> [u8; 16] {
        (self as u128).to_be_bytes()
    }
}

impl IntoU128BeBytes for u128 {
    fn to_u128_be_bytes(self) -> [u8; 16] {
        self.to_be_bytes()
    }
}
