// UI (trybuild) test: `#[has_role]` and `#[only_role]` compile for common signatures.
//
// Purpose:
// - Verifies the RBAC attribute macros can locate an `Env` argument anywhere in the signature.
// - Verifies both `Address` and `&Address` parameters are accepted.
// - Verifies role argument can be a literal or const expression.

use soroban_sdk::{contract, Address, Env};
use utils::{auth::Auth, rbac::RoleBasedAccessControl};

const MINTER_ROLE: &str = "minter";

#[contract]
pub struct MyContract;

impl Auth for MyContract {
    fn authorizer(_env: &Env) -> Option<Address> {
        None
    }
}

impl RoleBasedAccessControl for MyContract {}

impl MyContract {
    // Env by reference, Address by value, role literal.
    #[common_macros::has_role(caller, "minter")]
    pub fn f1(env: &Env, caller: Address) {
        let _ = (env, caller);
    }

    // Env by value, Address by value, role const expr.
    #[common_macros::has_role(caller, MINTER_ROLE)]
    pub fn f2(env: Env, caller: Address) {
        let _ = (env, caller);
    }

    // Env not first param, Address by value.
    #[common_macros::has_role(caller, "minter")]
    pub fn f3(x: u32, env: &Env, caller: Address) {
        let _ = (x, env, caller);
    }

    // &Address param is accepted (forwarded without extra borrow).
    #[common_macros::has_role(caller, "minter")]
    pub fn f4(env: &Env, caller: &Address) {
        let _ = (env, caller);
    }

    // only_role also injects `require_auth()`.
    #[common_macros::only_role(caller, "minter")]
    pub fn f5(env: &Env, caller: Address) {
        let _ = (env, caller);
    }

    // only_role also injects `require_auth()`.
    #[common_macros::only_role(caller, MINTER_ROLE)]
    pub fn f6(env: &Env, caller: Address) {
        let _ = (env, caller);
    }

    // Env not first param (only_role).
    #[common_macros::only_role(caller, "minter")]
    pub fn f7(x: u32, env: &Env, caller: Address) {
        let _ = (x, env, caller);
    }

    // Qualified Env + Address types are accepted.
    #[common_macros::has_role(caller, "minter")]
    pub fn f8(env: &soroban_sdk::Env, caller: soroban_sdk::Address) {
        let _ = (env, caller);
    }

    // Fully-qualified Env path + qualified &Address.
    #[common_macros::only_role(caller, MINTER_ROLE)]
    pub fn f9(x: u32, env: ::soroban_sdk::Env, caller: &soroban_sdk::Address) {
        let _ = (x, env, caller);
    }
}

fn main() {}
