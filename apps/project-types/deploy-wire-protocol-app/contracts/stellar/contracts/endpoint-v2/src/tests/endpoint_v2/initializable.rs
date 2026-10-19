use soroban_sdk::BytesN;

use crate::{
    tests::{
        endpoint_setup::setup,
        mock::{MockReceiver, MockReceiverReject},
    },
    Origin,
};

// New path initialization is gated by receiver.allow_initialize_path(...)
#[test]
fn test_initializable_new_path_receiver_allows() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    // Deploy mock receiver that allows initialization.
    let receiver = context.env.register(MockReceiver, ());
    let src_eid = 2u32;
    let sender = BytesN::from_array(&context.env, &[1u8; 32]);
    let origin = Origin { src_eid, sender, nonce: 1 };

    // For a new path (inbound_nonce is 0), initializable depends on receiver contract.
    let result = endpoint_client.initializable(&origin, &receiver);
    assert!(result);
}

#[test]
fn test_initializable_new_path_receiver_rejects() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    // Deploy mock receiver that rejects initialization.
    let receiver = context.env.register(MockReceiverReject, ());
    let src_eid = 2u32;
    let sender = BytesN::from_array(&context.env, &[1u8; 32]);
    let origin = Origin { src_eid, sender, nonce: 1 };

    // For a new path (inbound_nonce is 0), initializable depends on receiver contract.
    let result = endpoint_client.initializable(&origin, &receiver);
    assert!(!result);
}

// Established paths always return true (inbound_nonce > 0)
#[test]
fn test_initializable_established_path_always_true() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Deploy mock receiver that rejects initialization.
    let receiver = env.register(MockReceiverReject, ());
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Establish the path by skipping nonce 1.
    let nonce = 1u64;
    context.mock_auth(&receiver, "skip", (&receiver, &receiver, &src_eid, &sender, &nonce));
    context.endpoint_client.skip(&receiver, &receiver, &src_eid, &sender, &nonce);

    // Now the path is established (inbound_nonce > 0), it should return true regardless of receiver.
    let origin2 = Origin { src_eid, sender, nonce: 2 };
    let result = endpoint_client.initializable(&origin2, &receiver);
    assert!(result);
}
