//! PDA seeds and canonical addresses for policies and subject records.
use crate::ID;
use anchor_lang::prelude::*;

pub const PUBKEY_POLICY_SEED: &[u8] = b"pubkey_policy";
pub const SUBJECT_SEED: &[u8] = b"subject";

pub fn pubkey_policy_address(mint: &Pubkey, initializer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PUBKEY_POLICY_SEED, mint.as_ref(), initializer.as_ref()], &ID)
}

/// `subject`'s record address under `policy`, for a policy owned by this program.
pub fn subject_address(policy: &Pubkey, subject: &Pubkey) -> (Pubkey, u8) {
    subject_address_in(policy, subject, &ID)
}

/// `subject`'s record address under `policy`, as derived by the policy's owning `program`.
pub fn subject_address_in(policy: &Pubkey, subject: &Pubkey, program: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SUBJECT_SEED, policy.as_ref(), subject.as_ref()], program)
}
