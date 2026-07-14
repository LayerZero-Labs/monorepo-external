// UI (trybuild) negative test: `#[upgradeable]` requires `Self: utils::auth::Auth`.
//
// Purpose:
// - Ensures a contract using `#[upgradeable]` must also implement `Auth`
//   (e.g. via `#[ownable]` or `#[multisig]`).

use soroban_sdk::{contract, Env};
use utils::upgradeable::UpgradeableInternal;

#[contract]
#[common_macros::upgradeable]
pub struct MyContract;

impl UpgradeableInternal for MyContract {
    type MigrationData = ();

    fn __migrate(_env: &Env, _migration_data: &Self::MigrationData) {}
}

fn main() {}
