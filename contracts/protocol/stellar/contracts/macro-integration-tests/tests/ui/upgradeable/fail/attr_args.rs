// UI (trybuild) negative test: `#[upgradeable]` should reject unknown arguments.

use soroban_sdk::contract;

#[contract]
#[common_macros::ownable]
#[common_macros::upgradeable(not_migration)]
pub struct MyContract;

fn main() {}

