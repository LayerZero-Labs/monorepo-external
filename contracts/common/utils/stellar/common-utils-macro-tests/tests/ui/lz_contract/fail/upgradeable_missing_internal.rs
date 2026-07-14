// UI (trybuild) negative test: `#[lz_contract(upgradeable)]` should require `UpgradeableInternal`.
//
// Purpose:
// - Ensures the wrapper forwards the `upgradeable` behavior: the contract must implement
//   `utils::upgradeable::UpgradeableInternal` (unless using `upgradeable(no_migration)`).
// - Prevents regressions where the wrapper would silently stop requiring migration hooks.
#![allow(dead_code)]

use soroban_sdk::{BytesN, Env};

#[common_macros::lz_contract(upgradeable)]
pub struct MyContract;

fn smoke(env: &Env) {
    let hash = BytesN::<32>::from_array(env, &[0u8; 32]);
    // This call should fail to type-check because `UpgradeableInternal` is not implemented.
    MyContract::upgrade(env, &hash);
}

fn main() {}
