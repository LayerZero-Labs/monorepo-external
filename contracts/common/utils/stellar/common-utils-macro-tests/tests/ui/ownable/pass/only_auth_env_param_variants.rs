// UI (trybuild) test: `#[only_auth]` supports different `Env` parameter placements.
//
// Purpose:
// - Verifies `#[common_macros::only_auth]` can locate an `Env` argument in the function signature,
//   even when `Env` is not the first parameter.
// - Covers borrowed/owned, qualified paths, and `&mut Env`.

use soroban_sdk::{contract, Env};

#[contract]
#[common_macros::ownable]
pub struct MyContract;

impl MyContract {
    // `Env` as the first argument, by reference.
    #[common_macros::only_auth]
    pub fn f1(env: &Env) {
        let _ = env;
    }

    // `Env` not in the first position.
    #[common_macros::only_auth]
    pub fn f2(x: u32, env: &Env) {
        let _ = (x, env);
    }

    // `Env` using a fully-qualified type path.
    #[common_macros::only_auth]
    pub fn f3(env: &soroban_sdk::Env) {
        let _ = env;
    }

    // Env by value
    #[common_macros::only_auth]
    pub fn f4(env: Env) {
        let _ = env;
    }

    // Qualified Env by value, not first param
    #[common_macros::only_auth]
    pub fn f5(x: u32, env: soroban_sdk::Env) {
        let _ = (x, env);
    }

    // Mutable reference Env
    #[common_macros::only_auth]
    pub fn f6(env: &mut Env) {
        let _ = env;
    }
}

fn main() {}
