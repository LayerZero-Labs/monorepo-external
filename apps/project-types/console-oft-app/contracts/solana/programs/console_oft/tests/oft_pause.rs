//! Pause configuration. `send` refusing while paused is covered in `tests/integration`; role
//! direction in `oft_roles.rs`.
mod oft;

use console_oft::{
    errors::OFTError,
    events::{DefaultPauseSet, PauseSet},
    state::RoleType::{Pauser, Unpauser},
};
use oft::helpers::*;

const ID: u128 = DST_EID as u128;

#[test]
fn per_eid_pause_override_takes_precedence_until_removed() {
    let f = fixture();
    let oft_store = to_program_pubkey(&f.oft_store);
    let paused = |f: &OftFixture, id| f.view::<bool>(&is_paused_ix(f, id));

    let result = f.ok(&set_default_paused_ix(&f, f.admin, Pauser, true));
    assert_only_event(&result, DefaultPauseSet { oft_store, paused: true });
    assert!(paused(&f, ID));

    let result = f.ok(&set_paused_ix(&f, f.admin, Unpauser, ID, Some(false)));
    assert_only_event(&result, PauseSet { oft_store, id: ID, paused: Some(false) });
    assert!(!paused(&f, ID));
    assert!(paused(&f, ID + 1), "other EIDs keep the default");

    // Removing the override re-applies the paused default, so it needs the Pauser role.
    let result = f.ok(&set_paused_ix(&f, f.admin, Pauser, ID, None));
    assert_only_event(&result, PauseSet { oft_store, id: ID, paused: None });
    assert!(f.is_closed(&pause_config_pda(&f.oft_store, ID)));
    assert!(paused(&f, ID));
}

/// EVM parity: `setDefaultPaused` reverts when the state would not change.
#[test]
fn setting_the_default_pause_to_its_current_value_is_rejected() {
    let f = fixture();
    assert_eq!(
        f.fails(&set_default_paused_ix(&f, f.admin, Unpauser, false)),
        program_failure(OFTError::PauseStateIdempotent)
    );
    f.ok(&set_default_paused_ix(&f, f.admin, Pauser, true));
    assert_eq!(
        f.fails(&set_default_paused_ix(&f, f.admin, Pauser, true)),
        program_failure(OFTError::PauseStateIdempotent)
    );
}
