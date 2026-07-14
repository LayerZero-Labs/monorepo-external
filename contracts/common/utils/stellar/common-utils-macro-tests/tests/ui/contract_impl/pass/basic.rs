// UI (trybuild) test: `#[contract_impl]` on an impl block compiles.
//
// Purpose:
// - Verifies `#[common_macros::contract_impl]` can wrap a `impl MyContract { ... }` block.
// - Covers the "pass" surface area:
//   - Inherent impls: only **public** methods with an `Env` parameter are instrumented.
//   - Trait impls: **all** methods with an `Env` parameter are instrumented.
//   - Methods without `Env` are skipped.
//   - `__constructor` is instrumented to initialize default TTL configs.
//   - `Env` can be passed by `&Env` or `Env` (and must be the first param for soroban `contractimpl`).

use soroban_sdk::{contract, contracttrait, Env};

#[contract]
pub struct MyContract;

#[common_macros::contract_impl]
impl MyContract {
    // Public method with `&Env` (instrumented).
    pub fn ping(env: &Env) {
        let _ = env;
    }

    // Public method with `Env` by value (instrumented).
    pub fn ping_owned(env: Env) {
        let _ = env;
    }

    // Public method with extra args (still instrumented).
    pub fn ping_with_args(env: Env, x: u32) -> u32 {
        let _ = &env;
        x
    }

    // Public method with a fully-qualified Env path (instrumented).
    pub fn ping_fq_env(env: &soroban_sdk::Env) {
        let _ = env;
    }

    // Public method without `Env` (skipped).
    pub fn no_env(x: u32) -> u32 {
        x
    }

    // Constructor is instrumented to initialize default TTL configs.
    // This contract covers the `Env`-by-value variant.
    pub fn __constructor(env: Env) {
        let _ = env;
    }

    // Non-public methods in inherent impls are skipped (should still compile).
    fn private_with_env(env: &Env) {
        let _ = env;
    }

    // `pub(crate)` is also non-public in syn::Visibility terms (skipped in inherent impls).
    pub(crate) fn crate_visible_with_env(env: &Env) {
        let _ = env;
    }
}

#[contract]
pub struct MyContractCtorRef;

#[common_macros::contract_impl]
impl MyContractCtorRef {
    // Constructor is instrumented to initialize default TTL configs.
    // This contract covers the `&Env` variant.
    pub fn __constructor(env: &Env) {
        let _ = env;
    }

    // Include at least one regular entrypoint to ensure the impl is still processed.
    pub fn ping_ref(env: &Env) {
        let _ = env;
    }

    pub fn ping(env: Env) {
        let _ = env;
    }
}

// A neutral multi-method trait impl to better exercise the "trait impl branch"
#[contracttrait]
pub trait UiTraitImplBranch {
    fn t1(env: &Env);
    fn t2(env: &Env, x: u32) -> u32;
}

#[common_macros::contract_impl(contracttrait)]
impl UiTraitImplBranch for MyContract {
    fn t1(env: &Env) {
        let _ = env;
    }

    fn t2(env: &Env, x: u32) -> u32 {
        let _ = env;
        x
    }
}

fn main() {}
