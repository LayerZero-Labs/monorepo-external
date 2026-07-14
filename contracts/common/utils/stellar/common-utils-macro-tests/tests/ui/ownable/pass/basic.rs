// UI (trybuild) test: consolidated `#[ownable]` pass coverage.
//
// This file covers the core `#[ownable]` "pass" surface area:
// - OwnableInitializer helper (`init_owner`) and UFCS form
// - Auth impl exists
// - Ownable trait methods type-check
// - Macro expansion doesn't rely on downstream trait imports

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
#[common_macros::ownable]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn init(env: Env, owner: Address) {
        // `init_owner` helper exists.
        Self::init_owner(&env, &owner);

        // Also usable via fully-qualified trait path (doesn't rely on imports).
        <Self as utils::ownable::OwnableInitializer>::init_owner(&env, &owner);

        // Auth impl exists (type-check only).
        let _authorizer: Option<Address> = <Self as utils::auth::Auth>::authorizer(&env);

        // Ownable trait impl exists (type-check only).
        let _owner: Option<Address> = <Self as utils::ownable::Ownable>::owner(&env);
        let _pending_owner: Option<Address> = <Self as utils::ownable::Ownable>::pending_owner(&env);

        // A couple key Ownable APIs type-check.
        <Self as utils::ownable::Ownable>::transfer_ownership(&env, &owner);
        <Self as utils::ownable::Ownable>::begin_ownership_transfer(&env, &owner, 1);
        <Self as utils::ownable::Ownable>::accept_ownership(&env);
        <Self as utils::ownable::Ownable>::renounce_ownership(&env);
    }
}

fn main() {}
