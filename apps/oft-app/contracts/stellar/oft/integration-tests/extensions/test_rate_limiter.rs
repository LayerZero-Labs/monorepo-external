//! Rate Limiter extension e2e tests for OFT-STD.
//!
//! Tests verify that the RateLimiter extension properly enforces rate limits
//! on cross-chain transfers. Uses real EndpointV2 and SimpleMessageLib.

use crate::extensions::rate_limiter::{Direction, Mode};
use crate::integration_tests::{
    setup::{create_recipient_address, decode_packet, setup, wire_endpoint, wire_oft, TestSetup},
    utils::{
        address_to_peer_bytes32, advance_time, create_send_param, lz_receive, mint_oft_token_to, mint_to, quote_oft,
        quote_send, rate_limit_capacity, rate_limit_in_flight, scan_packet_sent_event, send, set_rate_limit,
        set_rate_limit_with_mode, try_send, validate_packet,
    },
};
use soroban_sdk::{testutils::Address as _, token::TokenClient, Address};

/// Test e2e send without rate limit (default - unlimited)
#[test]
fn test_send_without_rate_limit() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 100_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Default capacity should be i128::MAX (unlimited)
    let capacity = rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid);
    assert_eq!(capacity, i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid), 0);
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);

    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 50_000_000, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);

    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    let receiver_balance = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(receiver_balance, oft_receipt.amount_received_ld);
}

/// Test e2e send within rate limit succeeds
#[test]
fn test_send_within_rate_limit() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 100_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Set rate limit: 10M per 3600 seconds (1 hour)
    set_rate_limit(&env, &chain_a, &Direction::Outbound, chain_b.eid, 10_000_000, 3600);

    assert_eq!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid), 10_000_000);
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);

    // Send 5M (within limit)
    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 5_000_000, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);

    // Check in_flight BEFORE send
    let in_flight_before = rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid);
    assert_eq!(in_flight_before, 0, "in_flight should be 0 before send");

    // Send within rate limit
    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    // IMPORTANT: Scan events immediately after send, before any other operations
    let packet_event =
        scan_packet_sent_event(&env, &chain_a.endpoint.address).expect("packet_sent event should be emitted");

    // Verify capacity reduced
    let in_flight = rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid);
    assert_eq!(in_flight, oft_receipt.amount_received_ld, "in_flight should match amount sent");
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    let receiver_balance = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(receiver_balance, oft_receipt.amount_received_ld);
}

/// Test e2e send exceeding rate limit fails
#[test]
fn test_send_exceeds_rate_limit() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 100_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Set rate limit: 1M per 3600 seconds
    set_rate_limit(&env, &chain_a, &Direction::Outbound, chain_b.eid, 1_000_000, 3600);
    assert_eq!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid), 1_000_000);
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);

    // Try to send 5M (exceeds limit)
    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 5_000_000, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);

    let success = try_send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);
    assert!(!success);
    assert_eq!(rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid), 0);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);
}

/// Test rate limit decay over time
#[test]
fn test_rate_limit_decay() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 100_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Set rate limit: 10M per 1000 seconds
    set_rate_limit(&env, &chain_a, &Direction::Outbound, chain_b.eid, 10_000_000, 1000);
    assert_eq!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid), 10_000_000);
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);

    let to = address_to_peer_bytes32(&receiver);

    // Send 8M
    let send_param1 = create_send_param(&env, chain_b.eid, 8_000_000, 0, &to);
    let (_, _, oft_receipt1) = quote_oft(&chain_a, &sender, &send_param1);
    let fee1 = quote_send(&env, &chain_a, &sender, &send_param1, false);
    send(&env, &chain_a, &sender, &send_param1, &fee1, &sender, &oft_receipt1);

    let packet_event1 = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event1);
    let packet1 = decode_packet(&env, &packet_event1.0);
    lz_receive(&env, &chain_b, &executor, &packet1, &receiver, 0);

    // Only ~2M capacity remaining
    let capacity_before = rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid);
    assert!(capacity_before < 3_000_000);

    // Advance time by 500 seconds (50% of window) - should recover ~5M
    advance_time(&env, 500);

    let capacity_after = rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid);
    // Capacity should have increased due to decay
    assert!(capacity_after > capacity_before);

    // Now we should be able to send more
    let send_param2 = create_send_param(&env, chain_b.eid, 4_000_000, 0, &to);
    let (_, _, oft_receipt2) = quote_oft(&chain_a, &sender, &send_param2);
    let fee2 = quote_send(&env, &chain_a, &sender, &send_param2, false);
    send(&env, &chain_a, &sender, &send_param2, &fee2, &sender, &oft_receipt2);

    // Verify second send succeeded
    let packet_event2 = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event2);
    let packet2 = decode_packet(&env, &packet_event2.0);
    lz_receive(&env, &chain_b, &executor, &packet2, &receiver, 0);
    assert!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid) < 10_000_000);
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);
}

/// Test gross mode: round-trip shows gross mode doesn't release outbound capacity
#[test]
fn test_gross_mode_does_not_release() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender_a = Address::generate(&env);
    let sender_b = Address::generate(&env);
    let receiver_b = create_recipient_address(&env);
    let receiver_a = create_recipient_address(&env);
    let executor = Address::generate(&env);

    // Setup tokens for both chains
    mint_oft_token_to(&env, &chain_a, &sender_a, 100_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender_a, 10_000_000_000);
    mint_oft_token_to(&env, &chain_b, &sender_b, 100_000_000);
    mint_to(&env, &chain_b.owner, &chain_b.native_token, &sender_b, 10_000_000_000);

    // Set Gross mode rate limit on chain_a outbound: 10M per 3600 seconds
    set_rate_limit_with_mode(&env, &chain_a, &Direction::Outbound, chain_b.eid, 10_000_000, 3600, Mode::Gross);
    assert_eq!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid), 10_000_000);
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);

    // Step 1: Send 8M from chain_a to chain_b
    let to_b = address_to_peer_bytes32(&receiver_b);
    let send_param_1 = create_send_param(&env, chain_b.eid, 8_000_000, 0, &to_b);
    let (_, _, oft_receipt_1) = quote_oft(&chain_a, &sender_a, &send_param_1);
    let fee_1 = quote_send(&env, &chain_a, &sender_a, &send_param_1, false);
    send(&env, &chain_a, &sender_a, &send_param_1, &fee_1, &sender_a, &oft_receipt_1);

    let packet_event_1 = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event_1);
    let packet_1 = decode_packet(&env, &packet_event_1.0);

    // chain_a outbound should have 8M in-flight
    let in_flight_after_send = rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid);
    assert_eq!(in_flight_after_send, oft_receipt_1.amount_received_ld);
    assert_eq!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid), 10_000_000 - in_flight_after_send);

    // Step 2: Receive on chain_b and send 6M back to chain_a
    lz_receive(&env, &chain_b, &executor, &packet_1, &receiver_b, 0);

    let to_a = address_to_peer_bytes32(&receiver_a);
    let send_param_2 = create_send_param(&env, chain_a.eid, 6_000_000, 0, &to_a);
    let (_, _, oft_receipt_2) = quote_oft(&chain_b, &sender_b, &send_param_2);
    let fee_2 = quote_send(&env, &chain_b, &sender_b, &send_param_2, false);
    send(&env, &chain_b, &sender_b, &send_param_2, &fee_2, &sender_b, &oft_receipt_2);

    let packet_event_2 = scan_packet_sent_event(&env, &chain_b.endpoint.address).unwrap();
    validate_packet(&env, &chain_a, &packet_event_2);
    let packet_2 = decode_packet(&env, &packet_event_2.0);

    // Step 3: Receive back on chain_a - this calls __release_rate_limit_capacity for outbound
    lz_receive(&env, &chain_a, &executor, &packet_2, &receiver_a, 0);

    // In Gross mode, receiving back should NOT release the outbound capacity
    let in_flight_after_return = rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid);
    assert_eq!(
        in_flight_after_return, in_flight_after_send,
        "Gross mode: outbound in-flight should not decrease when receiving"
    );

    // Should only have ~2M capacity left, NOT 8M (if it were Net mode)
    let capacity_after_return = rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid);
    assert!(capacity_after_return < 3_000_000, "Gross mode: capacity should remain low");
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);
}

/// Test net mode (default): round-trip shows net mode releases outbound capacity
#[test]
fn test_net_mode_does_release() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender_a = Address::generate(&env);
    let sender_b = Address::generate(&env);
    let receiver_b = create_recipient_address(&env);
    let receiver_a = create_recipient_address(&env);
    let executor = Address::generate(&env);

    // Setup tokens for both chains
    mint_oft_token_to(&env, &chain_a, &sender_a, 100_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender_a, 10_000_000_000);
    mint_oft_token_to(&env, &chain_b, &sender_b, 100_000_000);
    mint_to(&env, &chain_b.owner, &chain_b.native_token, &sender_b, 10_000_000_000);

    // Set Net mode rate limit on chain_a outbound: 10M per 3600 seconds
    set_rate_limit_with_mode(&env, &chain_a, &Direction::Outbound, chain_b.eid, 10_000_000, 3600, Mode::Net);
    assert_eq!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid), 10_000_000);
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);

    // Step 1: Send 8M from chain_a to chain_b
    let to_b = address_to_peer_bytes32(&receiver_b);
    let send_param_1 = create_send_param(&env, chain_b.eid, 8_000_000, 0, &to_b);
    let (_, _, oft_receipt_1) = quote_oft(&chain_a, &sender_a, &send_param_1);
    let fee_1 = quote_send(&env, &chain_a, &sender_a, &send_param_1, false);
    send(&env, &chain_a, &sender_a, &send_param_1, &fee_1, &sender_a, &oft_receipt_1);

    let packet_event_1 = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event_1);
    let packet_1 = decode_packet(&env, &packet_event_1.0);

    // chain_a outbound should have 8M in-flight
    let in_flight_after_send = rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid);
    assert_eq!(in_flight_after_send, oft_receipt_1.amount_received_ld);
    assert_eq!(rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid), 10_000_000 - in_flight_after_send);

    // Step 2: Receive on chain_b and send 6M back to chain_a
    lz_receive(&env, &chain_b, &executor, &packet_1, &receiver_b, 0);

    let to_a = address_to_peer_bytes32(&receiver_a);
    let send_param_2 = create_send_param(&env, chain_a.eid, 6_000_000, 0, &to_a);
    let (_, _, oft_receipt_2) = quote_oft(&chain_b, &sender_b, &send_param_2);
    let fee_2 = quote_send(&env, &chain_b, &sender_b, &send_param_2, false);
    send(&env, &chain_b, &sender_b, &send_param_2, &fee_2, &sender_b, &oft_receipt_2);

    let packet_event_2 = scan_packet_sent_event(&env, &chain_b.endpoint.address).unwrap();
    validate_packet(&env, &chain_a, &packet_event_2);
    let packet_2 = decode_packet(&env, &packet_event_2.0);

    // Step 3: Receive back on chain_a - this calls __release_rate_limit_capacity for outbound
    lz_receive(&env, &chain_a, &executor, &packet_2, &receiver_a, 0);

    // In Net mode, receiving back SHOULD release the outbound capacity
    let in_flight_after_return = rate_limit_in_flight(&chain_a, &Direction::Outbound, chain_b.eid);
    assert!(
        in_flight_after_return < in_flight_after_send,
        "Net mode: outbound in-flight should decrease when receiving"
    );

    // Should have much more capacity now (8M sent - 6M received back = ~2M net)
    let capacity_after_return = rate_limit_capacity(&chain_a, &Direction::Outbound, chain_b.eid);
    assert!(capacity_after_return > 7_000_000, "Net mode: capacity should increase after receiving");
    assert_eq!(rate_limit_capacity(&chain_b, &Direction::Outbound, chain_a.eid), i128::MAX);
    assert_eq!(rate_limit_in_flight(&chain_b, &Direction::Outbound, chain_a.eid), 0);
}
