// Runtime tests: `#[contract_impl]` injects instance TTL extension.

use soroban_sdk::{contract, testutils::storage::Instance as _, testutils::Ledger as _, Env};
use utils::ttl_configurable::{TtlConfig, TtlConfigStorage};

#[contract]
pub struct TestContract;

#[common_macros::contract_impl]
impl TestContract {
    pub fn ping(env: &Env) {
        let _ = env;
    }
}

#[test]
fn ping_extends_instance_ttl_when_configured() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());

    // Seed instance storage so TTL is present.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "seed"), &true);
    });

    let before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let before_seq = env.ledger().sequence();
    let live_until = before_seq + before;

    // Configure the injected TTL extension to always trigger and extend beyond current TTL.
    let cfg = TtlConfig::new(10, before + 100);
    env.as_contract(&contract_id, || {
        TtlConfigStorage::set_instance(&env, &cfg);
    });

    // Force current TTL to be at/below threshold, then call ping.
    env.ledger().set_sequence_number(live_until.saturating_sub(cfg.threshold));
    let client = TestContractClient::new(&env, &contract_id);
    client.ping();

    let after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(after, cfg.extend_to);
}

#[test]
fn ping_does_not_extend_instance_ttl_without_config() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());

    // Seed instance storage so TTL is present.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "seed"), &true);
    });

    // Move ledger near expiry (would trigger if config existed).
    let before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let before_seq = env.ledger().sequence();
    let live_until = before_seq + before;
    env.ledger().set_sequence_number(live_until.saturating_sub(1));

    let ttl_before_call = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let client = TestContractClient::new(&env, &contract_id);
    client.ping();
    let ttl_after_call = env.as_contract(&contract_id, || env.storage().instance().get_ttl());

    assert_eq!(ttl_after_call, ttl_before_call);
}

#[test]
fn ping_does_not_extend_instance_ttl_when_above_threshold() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());

    // Seed instance storage so TTL is present.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "seed"), &true);
    });

    let initial_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let initial_seq = env.ledger().sequence();
    let live_until = initial_seq + initial_ttl;

    // Configure auto extension, but keep remaining TTL strictly greater than threshold.
    let cfg = TtlConfig::new(10, initial_ttl + 100);
    env.as_contract(&contract_id, || {
        TtlConfigStorage::set_instance(&env, &cfg);
    });

    env.ledger().set_sequence_number(live_until.saturating_sub(cfg.threshold.saturating_add(1)));
    let ttl_before_call = env.as_contract(&contract_id, || env.storage().instance().get_ttl());

    let client = TestContractClient::new(&env, &contract_id);
    client.ping();

    let ttl_after_call = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(ttl_after_call, ttl_before_call);
}
