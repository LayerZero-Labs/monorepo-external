// UI (trybuild) test: `#[contract_trait]` on a trait definition compiles.
//
// Purpose:
// - Verifies `#[common_macros::contract_trait]` can wrap a trait definition.
// - Covers the "pass" surface area:
//   - Default methods with an `Env` parameter are instrumented (by ref / owned / mut ref).
//   - Default methods without `Env` are skipped.
//   - Fully-qualified `soroban_sdk::Env` type path is accepted.
//   - Abstract methods remain valid alongside default methods.

use soroban_sdk::Env;

#[common_macros::contract_trait]
pub trait MyTrait {
    // Default method with `&Env`.
    fn ping(env: &Env) {
        let _ = env;
    }

    // Parameter name can be underscore-prefixed (still detected and used by injection).
    fn ping_underscore(_env: &Env) {
        let _ = _env;
    }

    // Default method with owned `Env`.
    fn ping_owned(env: Env) {
        let _ = &env;
    }

    // Owned `Env` can be declared mutable (pattern is still `Pat::Ident`).
    fn ping_owned_mut(mut env: Env) {
        let _ = &mut env;
    }

    // Default method with extra args + return.
    fn ping_with_args(env: &Env, x: u32) -> u32 {
        let _ = env;
        x
    }

    // Default method with fully-qualified Env path.
    fn ping_fq_env(env: &soroban_sdk::Env) {
        let _ = env;
    }

    // `&mut Env` should still work via coercion to `&Env` for the TTL-config lookup.
    fn ping_mut_ref(env: &mut Env) {
        let _ = env;
    }

    // Default method without `Env` is skipped by the macro (should still compile).
    fn no_env_default(x: u32) -> u32 {
        x
    }

    fn abstract_method(env: &Env) -> u32;
}

// UI: attribute arguments are forwarded to `#[soroban_sdk::contracttrait(...)]`.
#[common_macros::contract_trait(crate_path = "soroban_sdk")]
pub trait MyTraitWithAttr {
    fn ping(env: &Env) {
        let _ = env;
    }
}

// UI: trait items other than methods should remain valid (associated types/constants).
#[common_macros::contract_trait]
pub trait TraitWithAssociatedItems {
    type Assoc;
    const VERSION: u32 = 1;

    // Abstract method should remain valid alongside associated items.
    fn abstract_method(env: &Env) -> u32;

    // Default method with `Env` (still instrumented).
    fn default_method(env: &Env) -> u32 {
        let _ = env;
        Self::VERSION
    }
}

fn main() {}
