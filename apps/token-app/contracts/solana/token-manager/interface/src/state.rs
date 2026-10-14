//! The root account and the signer kinds it derives.
use anchor_lang::prelude::*;

/// An authority a root can hold, each through its own signer PDA ([`signer_address`]). The
/// TokenManager signs as a kind's PDA only for operations of that authority.
#[derive(Clone, Copy, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum SignerKind {
    /// Token ACL's `MintConfig.freeze_authority` (the logical freeze admin), not a Token-2022
    /// authority.
    Acl = 0,
    PermissionedBurn = 1,
    PermanentDelegate = 2,
    /// The Token-2022 pause authority; `pause` and `unpause` use it, and `pd_recover` resumes and
    /// re-pauses a paused mint around the recovery transfer.
    Pause = 3,
    /// The Token-2022 transfer-hook authority; `set_transfer_hook_policy` uses it to bind the
    /// pubkey-policy hook's policy.
    TransferHook = 4,
    /// The Token-2022 mint authority; `mint_to` uses it to mint for a `Minter`.
    Mint = 5,
}

impl SignerKind {
    pub const ALL: [SignerKind; 6] = [
        Self::Acl,
        Self::PermissionedBurn,
        Self::PermanentDelegate,
        Self::Pause,
        Self::TransferHook,
        Self::Mint,
    ];
}

/// The root for one mint at `[TOKEN_MANAGER_SEED, mint]`: the RBAC state its roles are scoped to.
/// It never signs; authorities are held by the separate signer PDAs from [`signer_address`].
/// `bootstrap` is the native holder that authorized creation; it may re-point the pending admin
/// only while no DefaultAdmin has accepted.
#[account]
#[derive(InitSpace, rbac::DefaultAdmin)]
pub struct TokenManagerStore {
    pub mint: Pubkey,
    pub current_default_admin: Pubkey,
    pub pending_default_admin: Pubkey,
    pub bootstrap: Pubkey,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_layout_is_fixed_and_round_trips() {
        let store = TokenManagerStore {
            mint: Pubkey::new_unique(),
            current_default_admin: Pubkey::new_unique(),
            pending_default_admin: Pubkey::default(),
            bootstrap: Pubkey::new_unique(),
        };
        let mut bytes = Vec::new();
        store.try_serialize(&mut bytes).unwrap();
        assert_eq!(8 + TokenManagerStore::INIT_SPACE, 136);
        assert_eq!(bytes.len(), 136);
        assert_eq!(&bytes[..8], TokenManagerStore::DISCRIMINATOR);
        let decoded = TokenManagerStore::try_deserialize(&mut bytes.as_slice()).unwrap();
        assert_eq!(decoded.bootstrap, store.bootstrap);
    }
}
