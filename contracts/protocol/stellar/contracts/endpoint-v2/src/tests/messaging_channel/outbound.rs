use soroban_sdk::{testutils::Address as _, Address, BytesN};

use crate::{endpoint_v2::EndpointV2, storage, tests::endpoint_setup::setup};

// Internal outbound() increments outbound nonce per path
#[test]
fn test_outbound_increments_and_is_path_scoped() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    // First call should return nonce 1
    let nonce1 =
        env.as_contract(&endpoint_client.address, || EndpointV2::outbound_for_test(env, &sender, dst_eid, &receiver));
    assert_eq!(nonce1, 1);

    // Second call should return nonce 2
    let nonce2 =
        env.as_contract(&endpoint_client.address, || EndpointV2::outbound_for_test(env, &sender, dst_eid, &receiver));
    assert_eq!(nonce2, 2);

    // Third call should return nonce 3
    let nonce3 =
        env.as_contract(&endpoint_client.address, || EndpointV2::outbound_for_test(env, &sender, dst_eid, &receiver));
    assert_eq!(nonce3, 3);

    // Different sender should have independent nonce counter (starts at 1)
    let different_sender = Address::generate(env);
    let nonce_diff_sender = env.as_contract(&endpoint_client.address, || {
        EndpointV2::outbound_for_test(env, &different_sender, dst_eid, &receiver)
    });
    assert_eq!(nonce_diff_sender, 1);

    // Different dst_eid should have independent nonce counter (starts at 1)
    let different_dst_eid = 3;
    let nonce_diff_dst = env.as_contract(&endpoint_client.address, || {
        EndpointV2::outbound_for_test(env, &sender, different_dst_eid, &receiver)
    });
    assert_eq!(nonce_diff_dst, 1);

    // Different receiver should have independent nonce counter (starts at 1)
    let different_receiver = BytesN::from_array(env, &[2u8; 32]);
    let nonce_diff_receiver = env.as_contract(&endpoint_client.address, || {
        EndpointV2::outbound_for_test(env, &sender, dst_eid, &different_receiver)
    });
    assert_eq!(nonce_diff_receiver, 1);

    // Verify state was updated correctly for original path.
    assert_eq!(endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver), 3);
}

// Outbound() panics on overflow (debug build behavior)
#[test]
#[should_panic(expected = "attempt to add with overflow")]
fn test_outbound_panics_on_u64_overflow() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    // Force the stored outbound nonce to u64::MAX, so (nonce + 1) overflows.
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_outbound_nonce(env, &sender, dst_eid, &receiver, &u64::MAX)
    });

    env.as_contract(&endpoint_client.address, || EndpointV2::outbound_for_test(env, &sender, dst_eid, &receiver));
}
