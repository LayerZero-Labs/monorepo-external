//! PDA seeds and canonical addresses for roots and signer PDAs.
use crate::{SignerKind, ID};
use anchor_lang::prelude::*;

pub const SIGNER_SEED: &[u8] = b"token_manager_signer";
pub const TOKEN_MANAGER_SEED: &[u8] = b"token_manager";

pub fn signer_address(state: &Pubkey, kind: SignerKind) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SIGNER_SEED, state.as_ref(), &[kind as u8]], &ID)
}

pub fn token_manager_address(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[TOKEN_MANAGER_SEED, mint.as_ref()], &ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_and_signer_addresses_are_distinct_per_kind() {
        let mint = Pubkey::new_unique();
        let root = token_manager_address(&mint).0;
        let signers = SignerKind::ALL.map(|kind| signer_address(&root, kind).0);
        for (i, signer) in signers.iter().enumerate() {
            assert!(!signers[i + 1..].contains(signer));
        }
        assert!(!signers.contains(&root));
    }
}
