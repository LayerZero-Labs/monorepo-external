use soroban_sdk::{testutils::Address as _, testutils::Ledger, vec, Address};

use crate::{tests::endpoint_setup::setup, MessageLibType, Timeout};

// The receive_library_timeout is scoped by (receiver, src_eid)
#[test]
fn test_receive_library_timeout_none_and_distinct_per_receiver_and_eid() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver_a = Address::generate(env);
    let receiver_b = Address::generate(env);

    let eid_a = context.eid;
    let eid_b = eid_a + 1;
    let eid_none = eid_a + 2;

    // Prepare timestamp.
    let now = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = now);

    // Create and register receive libs for each EID.
    let lib_a = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, eid_a]);
    let lib_b = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, eid_b]);
    context.register_library_with_auth(&lib_a);
    context.register_library_with_auth(&lib_b);

    // Each receiver sets a custom receive library for its EID (required: non-default receive library).
    context.mock_auth(
        &receiver_a,
        "set_receive_library",
        (&receiver_a, &receiver_a, &eid_a, &Some(lib_a.clone()), &0u64),
    );
    endpoint_client.set_receive_library(&receiver_a, &receiver_a, &eid_a, &Some(lib_a.clone()), &0u64);

    context.mock_auth(
        &receiver_b,
        "set_receive_library",
        (&receiver_b, &receiver_b, &eid_b, &Some(lib_b.clone()), &0u64),
    );
    endpoint_client.set_receive_library(&receiver_b, &receiver_b, &eid_b, &Some(lib_b.clone()), &0u64);

    // Set timeouts.
    let timeout_a = Some(Timeout { lib: lib_a.clone(), expiry: now + 1000 });
    let timeout_b = Some(Timeout { lib: lib_b.clone(), expiry: now + 2000 });

    context.mock_auth(&receiver_a, "set_receive_library_timeout", (&receiver_a, &receiver_a, &eid_a, &timeout_a));
    endpoint_client.set_receive_library_timeout(&receiver_a, &receiver_a, &eid_a, &timeout_a);

    context.mock_auth(&receiver_b, "set_receive_library_timeout", (&receiver_b, &receiver_b, &eid_b, &timeout_b));
    endpoint_client.set_receive_library_timeout(&receiver_b, &receiver_b, &eid_b, &timeout_b);

    // Verify view results.
    assert_eq!(endpoint_client.receive_library_timeout(&receiver_a, &eid_a), timeout_a);
    assert_eq!(endpoint_client.receive_library_timeout(&receiver_b, &eid_b), timeout_b);

    // Unset combinations remain None.
    assert_eq!(endpoint_client.receive_library_timeout(&receiver_a, &eid_none), None);
    assert_eq!(endpoint_client.receive_library_timeout(&receiver_b, &eid_none), None);
    assert_eq!(endpoint_client.receive_library_timeout(&Address::generate(env), &eid_a), None);
}
