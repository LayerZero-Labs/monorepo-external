//! The canonical SPL manifest is the hook's only persistent state.

use anchor_lang::prelude::*;
use pubkey_policy_interface::SUBJECT_SEED;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed};

pub const EXTRA_METAS_SEED: &[u8] = b"extra-account-metas";
pub const EXTRA_COUNT: usize = 5;
const SOURCE_ACCOUNT_INDEX: u8 = 0;
const PUBKEY_POLICY_ACCOUNT_INDEX: u8 = 5;
const DESTINATION_ACCOUNT_INDEX: u8 = 2;
const AUTHORITY_ACCOUNT_INDEX: u8 = 3;
const POLICY_PROGRAM_ACCOUNT_INDEX: u8 = 6;
// SPL account base layout: mint (32 bytes), then owner (32 bytes).
const TOKEN_ACCOUNT_OWNER_OFFSET: u8 = 32;
const PUBKEY_LENGTH: u8 = 32;

/// Execute accounts: source, mint, destination, authority, manifest, pubkey policy (5), the
/// program that owns it (6), and the source/destination/authority records under it (7-9).
pub fn account_metas(
    pubkey_policy: &Pubkey,
    policy_program: &Pubkey,
) -> Result<Vec<ExtraAccountMeta>> {
    let record = |subject_seed: Seed| {
        ExtraAccountMeta::new_external_pda_with_seeds(
            POLICY_PROGRAM_ACCOUNT_INDEX,
            &[
                Seed::Literal { bytes: SUBJECT_SEED.to_vec() },
                Seed::AccountKey { index: PUBKEY_POLICY_ACCOUNT_INDEX },
                subject_seed,
            ],
            false,
            false,
        )
    };
    Ok(vec![
        ExtraAccountMeta::new_with_pubkey(pubkey_policy, false, false)?,
        ExtraAccountMeta::new_with_pubkey(policy_program, false, false)?,
        record(Seed::AccountData {
            account_index: SOURCE_ACCOUNT_INDEX,
            data_index: TOKEN_ACCOUNT_OWNER_OFFSET,
            length: PUBKEY_LENGTH,
        })?,
        record(Seed::AccountData {
            account_index: DESTINATION_ACCOUNT_INDEX,
            data_index: TOKEN_ACCOUNT_OWNER_OFFSET,
            length: PUBKEY_LENGTH,
        })?,
        record(Seed::AccountKey { index: AUTHORITY_ACCOUNT_INDEX })?,
    ])
}
