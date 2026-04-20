// UI (trybuild) negative test: `#[lz_contract(multisig)]` should NOT expose ownable APIs.
//
// Purpose:
// - Ensures selecting `multisig` switches auth from ownable -> multisig.
// - `init_owner` is an ownable initializer API and should not exist on multisig contracts.

use soroban_sdk::{contractimpl, Address, BytesN, Env, Vec};

#[common_macros::lz_contract(multisig)]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn should_not_compile(env: Env, owner: Address) {
        // This should fail to compile if `#[ownable]` is not applied.
        Self::init_owner(&env, &owner);
    }
}

fn main() {}
