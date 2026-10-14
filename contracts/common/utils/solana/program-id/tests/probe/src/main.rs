//! Fixture for the sibling assertions: that changing PROBE_ID rebuilds, and that the expansion
//! keeps the `Pubkey::new_from_array([..])` shape the IDL address tooling matches on.
//!
//! `build-utils-rust resolve` skips `tests/`, so the anchor dependency here never reaches a
//! consumer.

use anchor_lang::prelude::*;
use program_id::declare_program_id;

declare_program_id!("PROBE_ID", "11111111111111111111111111111111");

fn main() {
    println!("{}", ID);
}
