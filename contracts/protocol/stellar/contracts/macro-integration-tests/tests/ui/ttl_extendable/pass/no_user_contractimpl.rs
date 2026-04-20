// UI (trybuild) test: `#[ttl_extendable]` works without a user `#[contractimpl]` block.
//
// Purpose:
// - Ensures the macro-generated `#[contractimpl(contracttrait)] impl TtlExtendable for Contract`
//   is sufficient to provide the `extend_instance_ttl` entrypoint.
// - Covers the common pattern where a contract wants only the TTL extension entrypoint.

use common_macros::ttl_extendable;
use soroban_sdk::{contract, Env};

#[contract]
#[ttl_extendable]
pub struct MyContract;

#[allow(dead_code)]
fn typecheck(env: &Env) {
    MyContract::extend_instance_ttl(env, 1, 2);
    <MyContract as utils::ttl_extendable::TtlExtendable>::extend_instance_ttl(env, 1, 2);
}

fn main() {}
