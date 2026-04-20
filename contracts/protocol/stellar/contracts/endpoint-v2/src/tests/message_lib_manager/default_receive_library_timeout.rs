use soroban_sdk::{testutils::Ledger, vec};

use crate::{tests::endpoint_setup::setup, MessageLibType, Timeout};

// The default_receive_library_timeout is per-EID (None for unset EIDs, distinct values per EID)
#[test]
fn test_default_receive_library_timeout_none_and_distinct_per_eid() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let eid_a = context.eid;
    let eid_b = eid_a + 1;
    let eid_none = eid_a + 2;

    let now = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = now);

    // Create and register receive libs for each EID.
    let lib_a = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, eid_a]);
    let lib_b = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, eid_b]);
    context.register_library_with_auth(&lib_a);
    context.register_library_with_auth(&lib_b);

    let timeout_a = Some(Timeout { lib: lib_a.clone(), expiry: now + 1000 });
    let timeout_b = Some(Timeout { lib: lib_b.clone(), expiry: now + 2000 });

    // Set timeouts as owner.
    context.mock_owner_auth("set_default_receive_lib_timeout", (&eid_a, &timeout_a));
    endpoint_client.set_default_receive_lib_timeout(&eid_a, &timeout_a);

    context.mock_owner_auth("set_default_receive_lib_timeout", (&eid_b, &timeout_b));
    endpoint_client.set_default_receive_lib_timeout(&eid_b, &timeout_b);

    assert_eq!(endpoint_client.default_receive_library_timeout(&eid_a), timeout_a);
    assert_eq!(endpoint_client.default_receive_library_timeout(&eid_b), timeout_b);

    // Setting other EIDs should not affect an unset EID.
    assert_eq!(endpoint_client.default_receive_library_timeout(&eid_none), None);
}
