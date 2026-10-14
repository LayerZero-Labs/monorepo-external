//! Resolve a Token-2022 transfer hook's `ExtraAccountMetaList` into planned account metas, for
//! planners that must name a hooked transfer's accounts without executing it.

use crate::{
    build_transfer_hook_execute_data, helpers::transfer_hook_accounts::TransferHookManifest,
};
use anchor_lang::prelude::*;
use oapp::common::AccountMetaRef;
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;
use spl_type_length_value::state::TlvStateBorrowed;

/// The SPL account layout a token account's PDA seeds may read from: mint, then owner.
pub fn token_account_seed_prefix(mint: Pubkey, owner: Pubkey) -> [u8; 64] {
    let mut prefix = [0; 64];
    prefix[..32].copy_from_slice(mint.as_ref());
    prefix[32..].copy_from_slice(owner.as_ref());
    prefix
}

/// The real destination identity and the bytes available for resolving its seeds. For an ATA
/// not yet created, use its actual address and [`token_account_seed_prefix`], never another
/// token account as a placeholder. Reads beyond the supplied bytes fail in SPL's resolver.
pub struct TransferHookDestination<'a> {
    pub key: Pubkey,
    pub data: &'a [u8],
}

/// Append the hook program, canonical manifest witness, and every resolved extra, in the group
/// layout [`crate::TransferHookAccounts`] parses.
///
/// `source`, `mint`, `destination`, `authority` and `meta_list` are the Token-2022 `Execute`
/// accounts 0–4, the index space extra-account seeds refer to. The witness is appended even when
/// unallocated; an initialized zero-entry list is not absence. Each extra is appended before the
/// next resolves, matching SPL's CPI helper, so later extras may use earlier ones as
/// `Seed::AccountKey`, but not as `Seed::AccountData`: a planner knows only their pubkeys.
///
/// Separate references rather than a struct so each borrow keeps its own lifetime; callers mix
/// `to_account_info()` temporaries with borrowed `remaining_accounts`.
#[allow(clippy::too_many_arguments)]
pub fn append_transfer_hook_accounts(
    accounts: &mut Vec<AccountMetaRef>,
    hook_program: &Pubkey,
    source: &AccountInfo,
    mint: &AccountInfo,
    destination: TransferHookDestination<'_>,
    authority: &AccountInfo,
    meta_list: &AccountInfo,
    amount_ld: u64,
) -> Result<()> {
    let manifest = TransferHookManifest::read(mint.key, hook_program, meta_list)?;
    accounts.push(AccountMetaRef { pubkey: (*hook_program).into(), is_writable: false });
    accounts.push(AccountMetaRef { pubkey: meta_list.key().into(), is_writable: false });
    if matches!(manifest, TransferHookManifest::Absent) {
        return Ok(());
    }

    let meta_list_data = meta_list.try_borrow_data()?;
    let state = TlvStateBorrowed::unpack(&meta_list_data)?;
    let extra_metas = ExtraAccountMetaList::unpack_with_tlv_state::<ExecuteInstruction>(&state)?;

    let source_data = source.try_borrow_data()?;
    let mint_data = mint.try_borrow_data()?;
    let authority_data = authority.try_borrow_data()?;

    // Fixed Execute accounts borrow their real data; progressively resolved extras contribute
    // only their pubkeys, which is all a planner can know.
    let mut resolved_extra_keys = Vec::with_capacity(extra_metas.len());
    let ix_data = build_transfer_hook_execute_data(amount_ld);
    for meta in extra_metas.iter() {
        let resolved = meta.resolve(&ix_data, hook_program, |i| match i {
            0 => Some((source.key, Some(source_data.as_ref()))),
            1 => Some((mint.key, Some(mint_data.as_ref()))),
            2 => Some((&destination.key, Some(destination.data))),
            3 => Some((authority.key, Some(authority_data.as_ref()))),
            4 => Some((meta_list.key, Some(meta_list_data.as_ref()))),
            i => resolved_extra_keys.get(i - 5).map(|key| (key, None)),
        })?;
        accounts.push(AccountMetaRef {
            pubkey: resolved.pubkey.into(),
            is_writable: resolved.is_writable,
        });
        resolved_extra_keys.push(resolved.pubkey);
    }

    Ok(())
}
