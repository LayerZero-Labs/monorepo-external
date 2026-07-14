//! Pausable extension e2e tests for OFT-STD.
//!
//! Tests verify that the Pausable extension properly blocks/allows send and receive
//! operations when the OFT is paused/unpaused. Uses real EndpointV2 and SimpleMessageLib.

use crate::integration_tests::{
    setup::{create_recipient_address, decode_packet, setup, wire_endpoint, wire_oft, TestSetup},
    utils::{
        address_to_peer_bytes32, create_send_param, is_paused, lz_receive, mint_oft_token_to, mint_to, quote_oft,
        quote_send, scan_packet_sent_event, send, set_paused, try_lz_receive, try_send, validate_packet,
    },
};
use soroban_sdk::{testutils::Address as _, token::TokenClient, Address};

/// Test e2e send succeeds when unpaused (default state)
#[test]
fn test_send_succeeds_when_unpaused() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);

    // Mint tokens (SAC admin is already the mock wrapper from setup)
    mint_oft_token_to(&env, &chain_a, &sender, 10_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Default state should be unpaused on both OFTs
    assert!(!is_paused(&chain_a));
    assert!(!is_paused(&chain_b));

    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 1_000_000, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);

    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    // Validate packet and deliver on chain B
    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    let executor = Address::generate(&env);
    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    // Verify balances
    let sender_balance = TokenClient::new(&env, &chain_a.oft_token).balance(&sender);
    let receiver_balance = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(sender_balance, 10_000_000 - oft_receipt.amount_sent_ld);
    assert_eq!(receiver_balance, oft_receipt.amount_received_ld);
}

/// Test e2e send fails when paused
#[test]
fn test_send_fails_when_paused() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 10_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 1_000_000, 0, &to);

    // Get quote BEFORE pausing (since quote_oft also checks pause state)
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);

    // Pause the OFT
    set_paused(&env, &chain_a, true);
    assert!(is_paused(&chain_a));
    assert!(!is_paused(&chain_b));

    // Send should fail when paused
    let success = try_send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);
    assert!(!success);
}

/// Test e2e receive fails when destination is paused
#[test]
fn test_receive_fails_when_paused() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 10_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Send from chain_a to chain_b
    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 1_000_000, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);
    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    // Pause chain_b's OFT before receiving
    set_paused(&env, &chain_b, true);
    assert!(is_paused(&chain_b));
    assert!(!is_paused(&chain_a));

    // Receive should fail on paused destination
    let success = try_lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);
    assert!(!success);
}

/// Test e2e cross-chain flow works after unpause
#[test]
fn test_cross_chain_succeeds_after_unpause() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 10_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Pause and then unpause on chain_a; chain_b remains unpaused throughout
    assert!(!is_paused(&chain_a));
    assert!(!is_paused(&chain_b));
    set_paused(&env, &chain_a, true);
    assert!(is_paused(&chain_a));
    assert!(!is_paused(&chain_b));
    set_paused(&env, &chain_a, false);
    assert!(!is_paused(&chain_a));
    assert!(!is_paused(&chain_b));

    // Send should work after unpause
    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 1_000_000, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);

    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    // Verify successful transfer
    let receiver_balance = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(receiver_balance, oft_receipt.amount_received_ld);
}
