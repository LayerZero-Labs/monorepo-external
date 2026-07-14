// UI (trybuild) test: `#[ttl_extendable]` on a contract struct compiles.
//
// Purpose:
// - Ensures `#[common_macros::ttl_extendable]` can be applied to a contract struct in a downstream crate.
// - Validates the macro-generated `TtlExtendable` contract entry exists and is callable.
//
// Note: renamed from `minimal_contract.rs` to `basic.rs` for consistency.

use common_macros::ttl_extendable;
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
#[ttl_extendable]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn smoke(env: Env) {
        Self::extend_instance_ttl(&env, 1, 2);
    }
}

fn main() {}
