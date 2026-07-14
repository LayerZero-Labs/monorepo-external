// UI (trybuild) negative test: `#[multisig]` should NOT expose ownable initializer APIs.
//
// Purpose:
// - Ensures multisig contracts are self-owning and do not implement OwnableInitializer.

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
#[common_macros::multisig]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn should_not_compile(env: Env, owner: Address) {
        // This should fail to compile because OwnableInitializer is not implemented.
        Self::init_owner(&env, &owner);
    }
}

fn main() {}
