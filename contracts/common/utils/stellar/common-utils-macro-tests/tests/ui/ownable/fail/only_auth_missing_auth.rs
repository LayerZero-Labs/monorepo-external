// UI (trybuild) negative test: `#[only_auth]` requires `Self: utils::auth::Auth`.
//
// Purpose:
// - Ensures we get a compile-time failure when a contract uses `#[only_auth]`
//   without implementing the `Auth` trait (e.g. missing `#[ownable]` / `#[multisig]`).

use soroban_sdk::{contract, Env};

#[contract]
pub struct MyContract;

impl MyContract {
    #[common_macros::only_auth]
    pub fn protected(env: &Env) {
        let _ = env;
    }
}

fn main() {}
