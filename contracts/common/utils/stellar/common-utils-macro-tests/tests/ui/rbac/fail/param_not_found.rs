// UI (trybuild) negative test: `#[has_role]` requires the first arg to name a parameter in the signature.

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    // Macro names `caller` but the signature uses `account`.
    #[common_macros::has_role(caller, "minter")]
    pub fn bad(env: Env, account: Address) {
        let _ = (env, account);
    }
}

fn main() {}

