// UI (trybuild) negative test: `#[upgradeable]` requires `UpgradeableInternal` impl.

use soroban_sdk::{contract, Address};

#[contract]
#[common_macros::ownable]
#[common_macros::upgradeable]
pub struct MyContract;

fn main() {}
