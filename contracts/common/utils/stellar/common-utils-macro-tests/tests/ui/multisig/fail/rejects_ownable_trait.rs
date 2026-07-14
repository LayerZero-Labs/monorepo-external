// UI (trybuild) negative test: `#[multisig]` should NOT implement the `Ownable` trait.
//
// Purpose:
// - MultiSig uses a self-owning authorization pattern (Auth::authorizer = contract address).
// - It should not expose `utils::ownable::Ownable` APIs like `owner()`.

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
#[common_macros::multisig]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn should_not_compile(env: Env) {
        let _ = <Self as utils::ownable::Ownable>::owner(&env);
    }
}

fn main() {}
