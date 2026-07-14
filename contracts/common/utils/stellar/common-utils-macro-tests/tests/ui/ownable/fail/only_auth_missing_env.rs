// UI (trybuild) negative test: `#[only_auth]` requires an `Env` parameter.
//
// Purpose:
// - Ensures the macro fails compilation when applied to a function that does not accept `Env`.
// - Validates the downstream UX: macro misuse should surface as a compile-time error.

use soroban_sdk::{contract, contractimpl};

#[contract]
#[common_macros::ownable]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    // Intentionally missing `Env`: should fail during macro expansion.
    #[common_macros::only_auth]
    pub fn bad(x: u32) {
        let _ = x;
    }
}

fn main() {}
