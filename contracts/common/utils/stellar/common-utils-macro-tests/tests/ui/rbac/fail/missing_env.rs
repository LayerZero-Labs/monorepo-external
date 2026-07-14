// UI (trybuild) negative test: `#[has_role]` requires an `Env` parameter.

use soroban_sdk::{contract, contractimpl, Address};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    // Intentionally missing `Env`: should fail during macro expansion.
    #[common_macros::has_role(caller, "minter")]
    pub fn bad(caller: Address) {
        let _ = caller;
    }
}

fn main() {}

