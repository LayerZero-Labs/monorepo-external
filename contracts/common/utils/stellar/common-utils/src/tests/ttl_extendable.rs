use crate::ttl_extendable::TtlExtendable;
use soroban_sdk::{contract, contractimpl, testutils::storage::Instance as _, testutils::Ledger as _, Env};

// ============================================
// Test Contract for TtlExtendable
// ============================================

#[contract]
pub struct TtlExtendableTestContract;

#[contractimpl(contracttrait)]
impl TtlExtendable for TtlExtendableTestContract {}

// ============================================
// TtlExtendable Tests
// ============================================

#[test]
fn test_extend_instance_ttl_updates_instance_ttl() {
    let env = Env::default();
    let contract_id = env.register(TtlExtendableTestContract, ());
    let client = TtlExtendableTestContractClient::new(&env, &contract_id);

    // This is a minimal, high-signal assertion:
    // verify we actually extended *instance* TTL via the Soroban host.
    let (ttl_before, seq_before) =
        env.as_contract(&contract_id, || (env.storage().instance().get_ttl(), env.ledger().sequence()));
    let live_until = seq_before + ttl_before;
    let threshold = ttl_before.saturating_sub(1);
    let extend_to = ttl_before + 500;

    // Move ledger sequence so TTL is below threshold, ensuring extension triggers.
    env.ledger().set_sequence_number(live_until - threshold);

    client.extend_instance_ttl(&threshold, &extend_to);

    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(ttl_after, extend_to);
}

#[test]
fn test_extend_instance_ttl_noop_when_above_threshold() {
    let env = Env::default();
    let contract_id = env.register(TtlExtendableTestContract, ());
    let client = TtlExtendableTestContractClient::new(&env, &contract_id);

    // First, force an extension so we have a known positive TTL baseline.
    let (ttl_before, seq_before) =
        env.as_contract(&contract_id, || (env.storage().instance().get_ttl(), env.ledger().sequence()));
    let live_until = seq_before + ttl_before;
    let threshold = ttl_before.saturating_sub(1);
    let extend_to = ttl_before + 500;
    env.ledger().set_sequence_number(live_until - threshold);
    client.extend_instance_ttl(&threshold, &extend_to);
    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(ttl_after, extend_to);

    // Now call again with a threshold below the current TTL; it should NOT extend further.
    let threshold = ttl_after.saturating_sub(1);
    let extend_to_2 = ttl_after + 500;
    client.extend_instance_ttl(&threshold, &extend_to_2);
    let ttl_after_2 = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(ttl_after_2, ttl_after);
}
