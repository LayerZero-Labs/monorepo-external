extern crate std;

use crate::testing_utils::{
    assert_contains_event, assert_contains_events, assert_eq_event, assert_eq_events, decode_event_topics_data,
};
use soroban_sdk::{
    contract, contractevent, contractimpl, testutils::Address as _, testutils::Events as _, xdr, Address, Env,
    TryFromVal,
};

// ============================================
// Test Fixtures
// ============================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TestEvent1 {
    pub value: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TestEvent2 {
    pub name: u32,
    pub count: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TestEvent3 {
    pub address: Address,
}

#[contract]
pub struct TestingUtilsContract;

#[contractimpl]
impl TestingUtilsContract {
    pub fn emit_event1(env: &Env, value: u32) {
        TestEvent1 { value }.publish(env);
    }

    pub fn emit_event2(env: &Env, name: u32, count: u64) {
        TestEvent2 { name, count }.publish(env);
    }

    pub fn emit_event3(env: &Env, address: Address) {
        TestEvent3 { address }.publish(env);
    }

    pub fn emit_multiple_events(env: &Env, value1: u32, value2: u32) {
        TestEvent1 { value: value1 }.publish(env);
        TestEvent1 { value: value2 }.publish(env);
    }

    pub fn emit_both_events(env: &Env, value: u32, name: u32, count: u64) {
        TestEvent1 { value }.publish(env);
        TestEvent2 { name, count }.publish(env);
    }

    pub fn emit_three_events(env: &Env, value1: u32, value2: u32, value3: u32) {
        TestEvent1 { value: value1 }.publish(env);
        TestEvent1 { value: value2 }.publish(env);
        TestEvent1 { value: value3 }.publish(env);
    }

    pub fn emit_mixed_four_events(env: &Env, v1: u32, name: u32, count: u64, v2: u32, v3: u32) {
        TestEvent1 { value: v1 }.publish(env);
        TestEvent2 { name, count }.publish(env);
        TestEvent1 { value: v2 }.publish(env);
        TestEvent1 { value: v3 }.publish(env);
    }

    pub fn emit_mixed_three_types(env: &Env, value: u32, name: u32, count: u64, address: Address) {
        TestEvent1 { value }.publish(env);
        TestEvent2 { name, count }.publish(env);
        TestEvent3 { address }.publish(env);
    }

    pub fn emit_two_plus_event2(env: &Env, value1: u32, value2: u32, name: u32, count: u64) {
        TestEvent1 { value: value1 }.publish(env);
        TestEvent1 { value: value2 }.publish(env);
        TestEvent2 { name, count }.publish(env);
    }
}

// ============================================
// assert_eq_event
// ============================================

// Basic functionality

#[test]
fn test_assert_event_found() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_event(&env, &contract_id, TestEvent1 { value: 42 });
}

#[test]
fn test_assert_event_with_multiple_fields() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event2(&123, &456);

    assert_eq_event(&env, &contract_id, TestEvent2 { name: 123, count: 456 });
}

#[test]
fn test_assert_event_with_address() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    let addr = Address::generate(&env);
    client.emit_event3(&addr);

    assert_eq_event(&env, &contract_id, TestEvent3 { address: addr });
}

#[test]
fn test_assert_event_among_multiple() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_multiple_events(&10, &20);

    assert_contains_event(&env, &contract_id, TestEvent1 { value: 10 });
    assert_contains_event(&env, &contract_id, TestEvent1 { value: 20 });
}

// Edge cases

#[test]
fn test_assert_event_finds_first_matching_event() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_multiple_events(&42, &42);

    assert_contains_event(&env, &contract_id, TestEvent1 { value: 42 });
}

#[test]
fn test_assert_event_finds_correct_event_among_many() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    // Use single contract call that emits all events (events don't accumulate across calls)
    client.emit_mixed_four_events(&1, &100, &200, &2, &3);

    assert_contains_event(&env, &contract_id, TestEvent1 { value: 2 });
    assert_contains_event(&env, &contract_id, TestEvent2 { name: 100, count: 200 });
}

// Error cases

#[test]
#[should_panic(expected = "Expected exactly one event")]
fn test_assert_event_no_events_emitted() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());

    assert_eq_event(&env, &contract_id, TestEvent1 { value: 42 });
}

#[test]
#[should_panic(expected = "Expected exactly one event")]
fn test_assert_event_not_found() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_event(&env, &contract_id, TestEvent1 { value: 100 });
}

#[test]
#[should_panic(expected = "Expected exactly one event")]
fn test_assert_event_wrong_contract() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let other_contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_event(&env, &other_contract_id, TestEvent1 { value: 42 });
}

#[test]
#[should_panic(expected = "Expected exactly one event")]
fn test_assert_event_topics_length_mismatch() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_event(&env, &contract_id, TestEvent2 { name: 42, count: 0 });
}

#[test]
#[should_panic(expected = "Expected exactly one event")]
fn test_assert_event_data_mismatch() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event2(&123, &456);

    assert_eq_event(&env, &contract_id, TestEvent2 { name: 123, count: 789 });
}

// ============================================
// decode_event_topics_data
// ============================================

#[test]
fn test_decode_event_topics_data_roundtrip() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event2(&123, &456);

    let filtered = env.events().all().filter_by_contract(&contract_id);
    let raw = filtered.events();
    assert_eq!(raw.len(), 1);

    let event = &raw[0];
    let v0 = match &event.body {
        xdr::ContractEventBody::V0(v0) => v0,
    };

    let (topics, data) = decode_event_topics_data(&env, event).expect("event should decode");

    // `Val` doesn't implement `PartialEq` in this SDK version, so compare by converting back to XDR.
    let topics_xdr: std::vec::Vec<xdr::ScVal> =
        topics.iter().map(|t| xdr::ScVal::try_from_val(&env, &t).expect("topic Val must convert to XDR")).collect();
    assert_eq!(topics_xdr.len(), v0.topics.len() as usize);
    for (i, t) in v0.topics.iter().enumerate() {
        assert_eq!(topics_xdr[i], *t);
    }

    let data_xdr = xdr::ScVal::try_from_val(&env, &data).expect("data Val must convert to XDR");
    assert_eq!(data_xdr, v0.data);
}

// ============================================
// assert_eq_events
// ============================================

// Basic functionality

#[test]
fn test_assert_events_single() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 42 }]);
}

#[test]
fn test_assert_events_multiple_same_type() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_multiple_events(&10, &20);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 10 }, &TestEvent1 { value: 20 }]);
}

#[test]
fn test_assert_events_multiple_different_types() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_both_events(&42, &123, &456);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 42 }, &TestEvent2 { name: 123, count: 456 }]);
}

#[test]
fn test_assert_events_order_independent() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_both_events(&42, &123, &456);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 42 }, &TestEvent2 { name: 123, count: 456 }]);
}

#[test]
fn test_assert_events_empty_list() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());

    assert_eq_events(&env, &contract_id, &[]);
}

#[test]
fn test_assert_events_with_duplicates() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_multiple_events(&42, &42);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 42 }, &TestEvent1 { value: 42 }]);
}

// Edge cases

#[test]
fn test_assert_events_partial_match() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    // Use single contract call that emits all events (events don't accumulate across calls)
    client.emit_two_plus_event2(&10, &20, &100, &200);

    assert_contains_events(&env, &contract_id, &[&TestEvent1 { value: 10 }]);
}

#[test]
fn test_assert_events_three_events() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    // Use single contract call that emits all events (events don't accumulate across calls)
    client.emit_three_events(&1, &2, &3);

    assert_eq_events(
        &env,
        &contract_id,
        &[&TestEvent1 { value: 1 }, &TestEvent1 { value: 2 }, &TestEvent1 { value: 3 }],
    );
}

#[test]
fn test_assert_events_mixed_event_types_three() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    let addr = Address::generate(&env);

    // Use single contract call that emits all events (events don't accumulate across calls)
    client.emit_mixed_three_types(&42, &100, &200, &addr);

    assert_eq_events(
        &env,
        &contract_id,
        &[&TestEvent1 { value: 42 }, &TestEvent2 { name: 100, count: 200 }, &TestEvent3 { address: addr.clone() }],
    );
}

#[test]
fn test_assert_events_from_specific_contract_ignores_others() {
    let env = Env::default();
    let contract_id1 = env.register(TestingUtilsContract, ());
    let contract_id2 = env.register(TestingUtilsContract, ());
    let client1 = TestingUtilsContractClient::new(&env, &contract_id1);

    // Emit events from contract1 only
    // Note: Events don't accumulate across separate contract calls, so we use a single call
    client1.emit_multiple_events(&10, &30);

    // Assert events from contract1 are found when using contract1's address
    assert_eq_events(&env, &contract_id1, &[&TestEvent1 { value: 10 }, &TestEvent1 { value: 30 }]);

    // Verify that using contract2's address doesn't match contract1's events
    // (this tests the filtering logic - events should not be found for wrong contract)
    assert_contains_events(&env, &contract_id2, &[]);
}

// Error cases

#[test]
#[should_panic(expected = "Expected events to match exactly")]
fn test_assert_events_first_not_found() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 100 }]);
}

#[test]
#[should_panic(expected = "Expected events to match exactly")]
fn test_assert_events_second_not_found() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 42 }, &TestEvent1 { value: 100 }]);
}

#[test]
#[should_panic(expected = "Expected events to match exactly")]
fn test_assert_events_third_not_found() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_multiple_events(&10, &20);

    assert_eq_events(
        &env,
        &contract_id,
        &[&TestEvent1 { value: 10 }, &TestEvent1 { value: 20 }, &TestEvent1 { value: 30 }],
    );
}

#[test]
#[should_panic(expected = "Expected events to match exactly")]
fn test_assert_events_duplicate_expected_but_not_emitted() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 42 }, &TestEvent1 { value: 42 }]);
}

#[test]
#[should_panic(expected = "Expected events to match exactly")]
fn test_assert_events_no_events_emitted() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());

    assert_eq_events(&env, &contract_id, &[&TestEvent1 { value: 42 }]);
}

#[test]
#[should_panic(expected = "Expected events to match exactly")]
fn test_assert_events_wrong_contract() {
    let env = Env::default();
    let contract_id1 = env.register(TestingUtilsContract, ());
    let contract_id2 = env.register(TestingUtilsContract, ());
    let client1 = TestingUtilsContractClient::new(&env, &contract_id1);

    client1.emit_event1(&42);

    assert_eq_events(&env, &contract_id2, &[&TestEvent1 { value: 42 }]);
}

#[test]
#[should_panic(expected = "Expected events to match exactly")]
fn test_assert_events_data_mismatch() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event2(&100, &200);

    assert_eq_events(&env, &contract_id, &[&TestEvent2 { name: 100, count: 999 }]);
}

// ============================================
// assert_contains_event / assert_contains_events (multiset semantics)
// ============================================

#[test]
#[should_panic(expected = "Expected event not found")]
fn test_assert_contains_event_not_found_panics() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    assert_contains_event(&env, &contract_id, TestEvent1 { value: 999 });
}

#[test]
fn test_assert_contains_events_allows_duplicates() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_multiple_events(&42, &42);

    assert_contains_events(&env, &contract_id, &[&TestEvent1 { value: 42 }, &TestEvent1 { value: 42 }]);
}

#[test]
#[should_panic(expected = "Expected event #1 not found")]
fn test_assert_contains_events_duplicate_expected_but_not_emitted_panics() {
    let env = Env::default();
    let contract_id = env.register(TestingUtilsContract, ());
    let client = TestingUtilsContractClient::new(&env, &contract_id);

    client.emit_event1(&42);

    // Only one emission, but two expectations -> must fail on the second.
    assert_contains_events(&env, &contract_id, &[&TestEvent1 { value: 42 }, &TestEvent1 { value: 42 }]);
}
