// Runtime tests: `#[ttl_extendable]` behavior (manual instance TTL extension).

use super::{TestContract, TestContractClient};
use soroban_sdk::testutils::{storage::Instance as _, Ledger as _};
use soroban_sdk::Env;
use utils::ttl_configurable::{TtlConfig, TtlConfigStorage};

#[test]
fn extend_instance_ttl_extends_instance_storage() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Ensure instance storage exists.
    client.touch();

    let before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let before_seq = env.ledger().sequence();
    let live_until = before_seq + before;

    // Move ledger forward so current TTL equals a small number, then extend.
    let threshold = 1u32;
    env.ledger().set_sequence_number(live_until.saturating_sub(threshold));
    let extend_to = threshold + 50;

    client.extend_instance_ttl(&threshold, &extend_to);

    let after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(after, extend_to);
}

#[test]
fn extend_instance_ttl_does_not_auto_extend_from_config() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Ensure instance storage exists so TTL is meaningful.
    client.touch();

    // Capture current TTL and compute live_until.
    let before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let before_seq = env.ledger().sequence();
    let live_until = before_seq + before;

    // Configure an instance TTL auto-extension config that would trigger at threshold=10 and extend to before+100.
    // NOTE: `#[ttl_extendable]` intentionally uses `#[soroban_sdk::contractimpl]` (not `common_macros::contract_impl`),
    // so calling `extend_instance_ttl` should NOT also run any auto-TTL extension logic.
    let cfg = TtlConfig::new(10, before + 100);
    env.as_contract(&contract_id, || {
        TtlConfigStorage::set_instance(&env, &cfg);
    });

    // Move ledger so current TTL equals cfg.threshold (this is the would-be auto-extension trigger point).
    env.ledger().set_sequence_number(live_until.saturating_sub(cfg.threshold));

    // Call manual extension with a threshold that should NOT trigger (0), regardless of extend_to.
    client.extend_instance_ttl(&0, &9999);

    // If auto-extension were incorrectly injected, TTL would become cfg.extend_to.
    // Instead, it should remain at the current TTL (cfg.threshold).
    let after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(after, cfg.threshold);
}
