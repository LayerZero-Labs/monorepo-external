// UI (trybuild) negative test: `#[ttl_configurable]` requires `Self: utils::auth::Auth`.
//
// Purpose:
// - Ensures we fail compilation when a contract uses `#[ttl_configurable]` without
//   also implementing `Auth` (e.g. missing `#[ownable]` / `#[multisig]`).

use common_macros::ttl_configurable;
use soroban_sdk::contract;

#[contract]
#[ttl_configurable]
pub struct MyContract;

fn main() {}
