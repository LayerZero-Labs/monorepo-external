use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError,
    events::PacketDelivered,
    tests::endpoint_setup::TestSetup,
    tests::{endpoint_setup::setup, mock::MockReceiver},
    util::{build_payload, keccak256},
    Origin,
};

fn build_payload_hash(env: &soroban_sdk::Env, guid: &BytesN<32>, message: &Bytes) -> BytesN<32> {
    let payload = build_payload(env, guid, message);
    keccak256(env, &payload)
}

fn verify_packet_with_auth(
    context: &TestSetup,
    receive_lib: &soroban_sdk::Address,
    origin: &Origin,
    receiver: &soroban_sdk::Address,
    payload_hash: &BytesN<32>,
) {
    context.mock_auth(receive_lib, "verify", (receive_lib, origin, receiver, payload_hash));
    context.endpoint_client.verify(receive_lib, origin, receiver, payload_hash);
}

fn clear_packet_with_auth(
    context: &TestSetup,
    caller: &soroban_sdk::Address,
    origin: &Origin,
    receiver: &soroban_sdk::Address,
    guid: &BytesN<32>,
    message: &Bytes,
) {
    context.mock_auth(caller, "clear", (caller, origin, receiver, guid, message));
    context.endpoint_client.clear(caller, origin, receiver, guid, message);
}

fn try_clear_packet_with_auth(
    context: &TestSetup,
    caller: &soroban_sdk::Address,
    origin: &Origin,
    receiver: &soroban_sdk::Address,
    guid: &BytesN<32>,
    message: &Bytes,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_auth(caller, "clear", (caller, origin, receiver, guid, message));
    context.endpoint_client.try_clear(caller, origin, receiver, guid, message)
}

fn arrange_verified_packet_with_auth(
    context: &TestSetup,
    src_eid: u32,
    sender: &BytesN<32>,
    receiver: &soroban_sdk::Address,
    nonce: u64,
    guid: &BytesN<32>,
    message: &Bytes,
) -> (soroban_sdk::Address, Origin, BytesN<32>) {
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);
    let origin = Origin { src_eid, sender: sender.clone(), nonce };
    let payload_hash = build_payload_hash(&context.env, guid, message);

    verify_packet_with_auth(context, &receive_lib, &origin, receiver, &payload_hash);

    (receive_lib, origin, payload_hash)
}

// Inbound payload hash storage / removal
#[test]
fn test_clear_removes_inbound_payload_hash() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let (_receive_lib, origin, payload_hash) =
        arrange_verified_packet_with_auth(&context, src_eid, &sender, &receiver, nonce, &guid, &message);

    // Verify payload hash exists before clear
    let hash_before_clear = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(hash_before_clear, Some(payload_hash.clone()), "Payload hash should exist before clear");

    // Now clear the payload
    clear_packet_with_auth(&context, &receiver, &origin, &receiver, &guid, &message);

    // Verify PacketDelivered event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        PacketDelivered { origin: origin.clone(), receiver: receiver.clone() },
    );

    // Verify payload hash was removed via public interface
    let stored_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(stored_hash, None);
}

// Inbound nonce is advanced during verify, not during clear
#[test]
fn test_clear_does_not_change_inbound_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let (_receive_lib, origin, _payload_hash) =
        arrange_verified_packet_with_auth(&context, src_eid, &sender, &receiver, nonce, &guid, &message);

    // Verify advanced inbound nonce (happens during verify).
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), nonce);

    clear_packet_with_auth(&context, &receiver, &origin, &receiver, &guid, &message);

    // Clear does not advance inbound nonce.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), nonce);
}

// Sequential nonce behavior
#[test]
fn test_clear_success_sequential_nonces_keep_inbound_nonce_at_latest_verified() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Verify and clear nonce 1
    let message1 = Bytes::from_array(env, &[1, 2, 3]);
    let guid1 = BytesN::from_array(env, &[1u8; 32]);
    let payload_hash1 = build_payload_hash(env, &guid1, &message1);
    let origin1 = Origin { src_eid, sender: sender.clone(), nonce: 1 };

    verify_packet_with_auth(&context, &receive_lib, &origin1, &receiver, &payload_hash1);
    clear_packet_with_auth(&context, &receiver, &origin1, &receiver, &guid1, &message1);

    // Verify and clear nonce 2
    let message2 = Bytes::from_array(env, &[4, 5, 6]);
    let guid2 = BytesN::from_array(env, &[2u8; 32]);
    let payload_hash2 = build_payload_hash(env, &guid2, &message2);
    let origin2 = Origin { src_eid, sender: sender.clone(), nonce: 2 };

    verify_packet_with_auth(&context, &receive_lib, &origin2, &receiver, &payload_hash2);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);

    clear_packet_with_auth(&context, &receiver, &origin2, &receiver, &guid2, &message2);
    // Verify advanced inbound nonce.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
}

// Authorization
#[test]
fn test_clear_failure_unauthorized_caller() {
    let context = setup();
    let env = &context.env;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    // Use MockReceiver (not MockReceiverReject) so verification succeeds
    let receiver = env.register(crate::tests::mock::MockReceiver, ());
    let nonce = 1u64;

    // Create message and payload
    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let payload_hash = build_payload_hash(env, &guid, &message);

    let origin = Origin { src_eid, sender: sender.clone(), nonce };

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // First verify the packet successfully (so we have something to clear)
    verify_packet_with_auth(&context, &receive_lib, &origin, &receiver, &payload_hash);

    // Now try to clear with unauthorized caller - caller is not receiver and not delegate
    // require_oapp_auth checks caller == receiver || caller == delegate first, then calls require_auth
    // Since caller != receiver and no delegate is set, it should fail with Unauthorized (21)
    let unauthorized_caller = soroban_sdk::Address::generate(env);
    let result = try_clear_packet_with_auth(&context, &unauthorized_caller, &origin, &receiver, &guid, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

#[test]
fn test_clear_failure_wrong_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    // Use a regular Address for receiver to avoid requiring a receiver contract implementation.
    // We initialize the path via `skip` so `verify` doesn't need to call `allow_initialize_path`.
    let receiver = Address::generate(env);
    let nonce = 2u64;

    // Set a delegate for receiver.
    let delegate = Address::generate(env);
    let delegate_opt = Some(delegate);
    context.set_delegate_with_auth(&receiver, &delegate_opt);

    // Initialize path by skipping nonce 1.
    context.mock_auth(&receiver, "skip", (&receiver, &receiver, &src_eid, &sender, &1u64));
    endpoint_client.skip(&receiver, &receiver, &src_eid, &sender, &1u64);

    // Create message and payload
    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let payload_hash = build_payload_hash(env, &guid, &message);

    let origin = Origin { src_eid, sender: sender.clone(), nonce };

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // First verify the packet successfully (so we have something to clear)
    verify_packet_with_auth(&context, &receive_lib, &origin, &receiver, &payload_hash);

    // Now try to clear with wrong delegate - caller is not receiver and not the configured delegate.
    let wrong_delegate = Address::generate(env);
    let result = try_clear_packet_with_auth(&context, &wrong_delegate, &origin, &receiver, &guid, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

#[test]
fn test_clear_success_delegate_can_clear() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    // Use a regular Address for receiver to avoid requiring a receiver contract implementation.
    // We initialize the path via `skip` so `verify` doesn't need to call `allow_initialize_path`.
    let receiver = Address::generate(env);
    let delegate = Address::generate(env);
    let nonce = 2u64;

    let delegate_opt = Some(delegate.clone());
    context.set_delegate_with_auth(&receiver, &delegate_opt);

    // Initialize path by skipping nonce 1.
    context.mock_auth(&receiver, "skip", (&receiver, &receiver, &src_eid, &sender, &1u64));
    endpoint_client.skip(&receiver, &receiver, &src_eid, &sender, &1u64);

    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);
    let origin = Origin { src_eid, sender: sender.clone(), nonce };
    let payload_hash = build_payload_hash(env, &guid, &message);
    verify_packet_with_auth(&context, &receive_lib, &origin, &receiver, &payload_hash);

    clear_packet_with_auth(&context, &delegate, &origin, &receiver, &guid, &message);

    // Sanity: payload hash for nonce was removed.
    let stored_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(stored_hash, None);
}

// Payload hash validation
#[test]
fn test_clear_failure_wrong_payload_hash() {
    let context = setup();
    let env = &context.env;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(crate::tests::mock::MockReceiver, ());
    let nonce = 1u64;

    // Create message and payload
    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let payload_hash = build_payload_hash(env, &guid, &message);

    let origin = Origin { src_eid, sender: sender.clone(), nonce };

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // First verify the packet
    verify_packet_with_auth(&context, &receive_lib, &origin, &receiver, &payload_hash);

    // Try to clear with wrong message (different payload hash)
    let wrong_message = Bytes::from_array(env, &[9, 9, 9, 9]);

    let result = try_clear_packet_with_auth(&context, &receiver, &origin, &receiver, &guid, &wrong_message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PayloadHashNotFound.into());
}

#[test]
fn test_clear_failure_duplicate_clear() {
    let context = setup();
    let env = &context.env;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let (_receive_lib, origin, _payload_hash) =
        arrange_verified_packet_with_auth(&context, src_eid, &sender, &receiver, nonce, &guid, &message);

    // First clear succeeds.
    clear_packet_with_auth(&context, &receiver, &origin, &receiver, &guid, &message);

    // Second clear should fail because payload hash has been removed.
    let result = try_clear_packet_with_auth(&context, &receiver, &origin, &receiver, &guid, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PayloadHashNotFound.into());
}

// Nonce ordering validation
#[test]
fn test_clear_failure_missing_intermediate_nonce() {
    let context = setup();
    let env = &context.env;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(crate::tests::mock::MockReceiver, ());

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Verify and store nonce 1
    let message1 = Bytes::from_array(env, &[1, 2, 3]);
    let guid1 = BytesN::from_array(env, &[1u8; 32]);
    let payload_hash1 = build_payload_hash(env, &guid1, &message1);
    let origin1 = Origin { src_eid, sender: sender.clone(), nonce: 1 };

    verify_packet_with_auth(&context, &receive_lib, &origin1, &receiver, &payload_hash1);

    // Verify and store nonce 3 (skip nonce 2)
    let message3 = Bytes::from_array(env, &[3, 3, 3]);
    let guid3 = BytesN::from_array(env, &[3u8; 32]);
    let payload_hash3 = build_payload_hash(env, &guid3, &message3);
    let origin3 = Origin { src_eid, sender: sender.clone(), nonce: 3 };

    verify_packet_with_auth(&context, &receive_lib, &origin3, &receiver, &payload_hash3);

    // Clear nonce 1 first
    clear_packet_with_auth(&context, &receiver, &origin1, &receiver, &guid1, &message1);

    // Try to clear nonce 3 - should panic because nonce 2 is missing
    let result = try_clear_packet_with_auth(&context, &receiver, &origin3, &receiver, &guid3, &message3);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidNonce.into());
}

#[test]
fn test_clear_does_not_advance_inbound_nonce_when_clearing_older_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());

    // Setup receive library once for the path.
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Verify nonce 1 and nonce 2.
    let message1 = Bytes::from_array(env, &[1, 2, 3]);
    let guid1 = BytesN::from_array(env, &[1u8; 32]);
    let payload_hash1 = build_payload_hash(env, &guid1, &message1);
    let origin1 = Origin { src_eid, sender: sender.clone(), nonce: 1 };
    verify_packet_with_auth(&context, &receive_lib, &origin1, &receiver, &payload_hash1);

    let message2 = Bytes::from_array(env, &[4, 5, 6]);
    let guid2 = BytesN::from_array(env, &[2u8; 32]);
    let payload_hash2 = build_payload_hash(env, &guid2, &message2);
    let origin2 = Origin { src_eid, sender: sender.clone(), nonce: 2 };
    verify_packet_with_auth(&context, &receive_lib, &origin2, &receiver, &payload_hash2);

    // Clear nonce 2 first. This does not advance inbound nonce (it was advanced during verify).
    clear_packet_with_auth(&context, &receiver, &origin2, &receiver, &guid2, &message2);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);

    // Clearing an older nonce should not change inbound nonce.
    clear_packet_with_auth(&context, &receiver, &origin1, &receiver, &guid1, &message1);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
}
