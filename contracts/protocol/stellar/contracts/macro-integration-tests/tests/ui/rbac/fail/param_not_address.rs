// UI (trybuild) negative test: `#[has_role]` requires the named parameter to be `Address` or `&Address`.

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    // `caller` exists but is not an Address type.
    #[common_macros::has_role(caller, "minter")]
    pub fn bad(env: Env, caller: u32) {
        let _ = (env, caller);
    }
}

fn main() {}

