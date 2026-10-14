//! The permissionless cache syncs `lz_receive_types_info` depends on, and the events that let
//! automation notice them.
mod oft;

use console_oft::events::{AclGatingProgramSynced, TransferHookProgramSynced};
use oft::helpers::*;
use solana_pubkey::Pubkey;

#[test]
fn syncs_record_the_mints_current_programs_and_emit_them() {
    let f = fixture();
    let oft_store = to_program_pubkey(&f.oft_store);
    let event_authority = to_program_pubkey(&event_authority_pda());

    // A mint without a transfer hook, and without a Token ACL config; both caches start stale.
    let mint_config =
        token_manager_interface::acl::mint_config_address(&to_program_pubkey(&f.token_mint));
    f.insert(host(mint_config), solana_account::Account::default());
    f.update_store(|store| {
        store.transfer_hook_program = to_program_pubkey(&Pubkey::new_unique());
        store.acl_gating_program = to_program_pubkey(&Pubkey::new_unique());
    });
    let sync_hook = oft_ix(
        console_oft::accounts::SyncTransferHookProgram {
            oft_store,
            token_mint: to_program_pubkey(&f.token_mint),
            event_authority,
            program: console_oft::ID,
        },
        console_oft::instruction::SyncTransferHookProgram {},
    );
    let sync_gate = oft_ix(
        console_oft::accounts::SyncAclGatingProgram {
            oft_store,
            mint_config,
            event_authority,
            program: console_oft::ID,
        },
        console_oft::instruction::SyncAclGatingProgram {},
    );

    assert_only_event(
        &f.ok(&sync_hook),
        TransferHookProgramSynced { oft_store, transfer_hook_program: Default::default() },
    );
    assert_eq!(f.store().transfer_hook_program, Default::default());
    assert_only_event(
        &f.ok(&sync_gate),
        AclGatingProgramSynced { oft_store, acl_gating_program: Default::default() },
    );
    assert_eq!(f.store().acl_gating_program, Default::default());

    // Anyone can call the syncs: once the cache is current, a repeat call emits nothing.
    assert_no_events(&f.ok(&sync_hook));
    assert_no_events(&f.ok(&sync_gate));
}
