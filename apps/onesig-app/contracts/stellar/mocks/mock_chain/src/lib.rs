#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, IntoVal, Symbol, Val, Vec};

#[contracttype]
pub enum DataKey {
    Count,
}

#[contract]
pub struct MockChain;

#[contractimpl]
impl MockChain {
    /// Requires auth from `from`, increments a call counter, then optionally
    /// forwards to the next contract in the chain.
    ///
    /// `chain` is a list of contract addresses forming the remaining call chain.
    /// - If non-empty, calls `chain[0].call_deep(from, chain[1..])`.
    /// - If empty, this is the leaf — just require auth, increment count, and return.
    ///
    /// Example 3-level deep chain (A → B → C):
    ///   A.call_deep(onesig, [B, C])
    ///     → requires onesig auth, count++, calls B.call_deep(onesig, [C])
    ///       → requires onesig auth, count++, calls C.call_deep(onesig, [])
    ///         → requires onesig auth, count++, done
    pub fn call_deep(env: Env, from: Address, chain: Vec<Address>) {
        from.require_auth();

        // Increment the call counter
        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        env.storage().instance().set(&DataKey::Count, &(count + 1));

        if let Some(next) = chain.first() {
            let remaining = chain.slice(1..chain.len());
            let args: Vec<Val> =
                Vec::from_array(&env, [from.into_val(&env), remaining.into_val(&env)]);
            env.invoke_contract::<()>(&next, &Symbol::new(&env, "call_deep"), args);
        }
    }

    /// Returns the number of times `call_deep` has been called on this contract.
    pub fn count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{vec, Env};

    #[test]
    fn test_call_deep_leaf() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(MockChain, ());
        let client = MockChainClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        client.call_deep(&user, &vec![&env]);
        assert_eq!(client.count(), 1);
    }

    #[test]
    fn test_call_deep_two_levels() {
        let env = Env::default();
        env.mock_all_auths();

        let a = env.register(MockChain, ());
        let b = env.register(MockChain, ());
        let client_a = MockChainClient::new(&env, &a);
        let client_b = MockChainClient::new(&env, &b);
        let user = Address::generate(&env);

        client_a.call_deep(&user, &vec![&env, b]);
        assert_eq!(client_a.count(), 1);
        assert_eq!(client_b.count(), 1);
    }

    #[test]
    fn test_call_deep_three_levels() {
        let env = Env::default();
        env.mock_all_auths();

        let a = env.register(MockChain, ());
        let b = env.register(MockChain, ());
        let c = env.register(MockChain, ());
        let client_a = MockChainClient::new(&env, &a);
        let client_b = MockChainClient::new(&env, &b);
        let client_c = MockChainClient::new(&env, &c);
        let user = Address::generate(&env);

        client_a.call_deep(&user, &vec![&env, b, c]);
        assert_eq!(client_a.count(), 1);
        assert_eq!(client_b.count(), 1);
        assert_eq!(client_c.count(), 1);
    }
}
