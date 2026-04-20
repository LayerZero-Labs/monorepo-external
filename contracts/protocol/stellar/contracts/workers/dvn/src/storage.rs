use crate::DstConfig;
use common_macros::storage;
use soroban_sdk::{Address, BytesN};

/// DVN contract storage keys.
///
/// Note: MultiSig storage (Signers, Threshold) is provided by `utils::multisig::MultiSigStorage`.
#[storage]
pub enum DvnStorage {
    /// Verifier ID - unique identifier for this DVN instance.
    #[instance(u32)]
    Vid,

    /// Registered upgrader contract address for upgrade operations.
    #[instance(Address)]
    Upgrader,

    /// Destination chain configuration, keyed by endpoint ID.
    #[persistent(DstConfig)]
    DstConfig { dst_eid: u32 },

    /// Tracks used hashes for replay protection.
    #[persistent(bool)]
    #[default(false)]
    UsedHash { hash: BytesN<32> },
}
