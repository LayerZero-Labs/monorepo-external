//! `permissioned_burn`, the TokenManager instruction other programs invoke. Its discriminator,
//! account order and argument are an ABI that a successor TokenManager program must keep, so a
//! consumer can switch to that program's root without an upgrade.
use anchor_lang::{prelude::*, solana_program::instruction::Instruction};
use spl_discriminator::SplDiscriminate;

/// `permissioned_burn`'s discriminator, hashed from a namespaced name at compile time; the
/// program declares it with `#[instruction(discriminator = ...)]`.
#[derive(SplDiscriminate)]
#[discriminator_hash_input("token-manager:permissioned-burn")]
pub struct PermissionedBurnInstruction;

/// `permissioned_burn`'s accounts; the token program is always Token-2022. `authority` holds the
/// root's Burner role (`role_member` is its role PDA) and signs. `source_authority` is the token
/// account's owner or delegate and is not marked as a signer: its signature reaches Token-2022
/// when it is the same key as `authority` (the runtime merges a key's privileges) or through native
/// multisig signers appended as remaining accounts.
pub struct PermissionedBurn {
    pub authority: Pubkey,
    pub token_manager: Pubkey,
    pub pb_signer: Pubkey,
    pub mint: Pubkey,
    pub token_account: Pubkey,
    pub source_authority: Pubkey,
    pub role_member: Pubkey,
}

impl PermissionedBurn {
    pub fn instruction(&self, program_id: Pubkey, amount: u64) -> Instruction {
        let mut data = PermissionedBurnInstruction::SPL_DISCRIMINATOR_SLICE.to_vec();
        data.extend_from_slice(&amount.to_le_bytes());
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.authority, true),
                AccountMeta::new_readonly(self.token_manager, false),
                AccountMeta::new_readonly(self.pb_signer, false),
                AccountMeta::new(self.mint, false),
                AccountMeta::new(self.token_account, false),
                AccountMeta::new_readonly(self.source_authority, false),
                AccountMeta::new_readonly(spl_token_2022_interface::ID, false),
                AccountMeta::new_readonly(self.role_member, false),
            ],
            data,
        }
    }
}
