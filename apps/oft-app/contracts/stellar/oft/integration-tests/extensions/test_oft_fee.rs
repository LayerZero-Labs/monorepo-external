//! OFT Fee extension e2e tests for OFT-STD.
//!
//! Tests verify that the OFTFee extension properly collects fees on cross-chain transfers.
//! Key behavior: at debit_view, apply fee first then remove dust.
//! - If fee is zero: amount_sent_ld == amount_received_ld
//! - If fee is non-zero: amount_sent_ld is unchanged (original amount)

use crate::integration_tests::{
    setup::{create_recipient_address, decode_packet, setup, wire_endpoint, wire_oft, TestSetup},
    utils::{
        address_to_peer_bytes32, create_send_param, lz_receive, mint_oft_token_to, mint_to, quote_oft, quote_send,
        scan_packet_sent_event, send, send_with_fee, set_default_fee_bps, set_fee_bps, set_fee_deposit_address,
        token_balance, validate_packet,
    },
};
use soroban_sdk::{testutils::Address as _, token::TokenClient, Address};

/// Test e2e cross-chain transfer with zero fee (default)
#[test]
fn test_cross_chain_with_zero_fee() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 10_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Default fee state on both OFTs
    assert_eq!(chain_a.oft.default_fee_bps(), None);
    assert_eq!(chain_a.oft.fee_deposit_address(), None);
    assert_eq!(chain_a.oft.effective_fee_bps(&chain_b.eid), 0);
    assert_eq!(chain_b.oft.default_fee_bps(), None);
    assert_eq!(chain_b.oft.fee_deposit_address(), None);
    assert_eq!(chain_b.oft.effective_fee_bps(&chain_a.eid), 0);

    let to = address_to_peer_bytes32(&receiver);
    let send_param = create_send_param(&env, chain_b.eid, 1_000_000, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);

    // With zero fee, amount_sent_ld == amount_received_ld (after dust removal)
    assert_eq!(oft_receipt.amount_sent_ld, oft_receipt.amount_received_ld);

    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);
    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    // Verify receiver got full amount (no fee)
    let receiver_balance = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(receiver_balance, oft_receipt.amount_received_ld);
}

/// Test e2e cross-chain transfer with fee enabled
#[test]
fn test_cross_chain_with_fee() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 10_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Enable 1% fee (100 bps)
    set_fee_deposit_address(&env, &chain_a, &chain_a.fee_collector);
    set_default_fee_bps(&env, &chain_a, 100);
    assert_eq!(chain_a.oft.default_fee_bps(), Some(100));
    assert_eq!(chain_a.oft.fee_deposit_address(), Some(chain_a.fee_collector.clone()));
    assert_eq!(chain_a.oft.effective_fee_bps(&chain_b.eid), 100);
    assert_eq!(chain_b.oft.default_fee_bps(), None);
    assert_eq!(chain_b.oft.fee_deposit_address(), None);
    assert_eq!(chain_b.oft.effective_fee_bps(&chain_a.eid), 0);

    let to = address_to_peer_bytes32(&receiver);
    let amount_ld = 1_000_000i128;
    let send_param = create_send_param(&env, chain_b.eid, amount_ld, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);

    // With fee, amount_sent_ld stays original, amount_received_ld is reduced
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
    assert!(oft_receipt.amount_received_ld < amount_ld);

    // Expected fee: 1% of 1,000,000 = 10,000
    let expected_fee = 10_000i128;
    let actual_fee = oft_receipt.amount_sent_ld - oft_receipt.amount_received_ld;
    assert_eq!(actual_fee, expected_fee);

    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);
    send_with_fee(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt, &chain_a.fee_collector);

    // IMPORTANT: Scan events immediately after send, before any other operations
    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    // Verify fee was collected on source chain
    let fee_collector_balance = token_balance(&env, &chain_a.oft_token, &chain_a.fee_collector);
    assert_eq!(fee_collector_balance, expected_fee);

    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    // Verify receiver got amount after fee
    let receiver_balance = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(receiver_balance, oft_receipt.amount_received_ld);
}

/// Test e2e cross-chain transfer with destination-specific fee
#[test]
fn test_cross_chain_with_destination_specific_fee() {
    let TestSetup { env, chain_a, chain_b } = setup();
    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = create_recipient_address(&env);
    let executor = Address::generate(&env);

    mint_oft_token_to(&env, &chain_a, &sender, 10_000_000);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10_000_000_000);

    // Set default fee 1% and destination-specific fee 2% for chain_b
    set_fee_deposit_address(&env, &chain_a, &chain_a.fee_collector);
    set_default_fee_bps(&env, &chain_a, 100); // 1%
    set_fee_bps(&env, &chain_a, chain_b.eid, 200); // 2% for chain_b
    assert_eq!(chain_a.oft.default_fee_bps(), Some(100));
    assert_eq!(chain_a.oft.fee_bps(&chain_b.eid), Some(200));
    assert_eq!(chain_a.oft.fee_deposit_address(), Some(chain_a.fee_collector.clone()));
    assert_eq!(chain_a.oft.effective_fee_bps(&chain_b.eid), 200);
    assert_eq!(chain_b.oft.default_fee_bps(), None);
    assert_eq!(chain_b.oft.fee_bps(&chain_a.eid), None);
    assert_eq!(chain_b.oft.fee_deposit_address(), None);
    assert_eq!(chain_b.oft.effective_fee_bps(&chain_a.eid), 0);

    let to = address_to_peer_bytes32(&receiver);
    let amount_ld = 1_000_000i128;
    let send_param = create_send_param(&env, chain_b.eid, amount_ld, 0, &to);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);

    // 2% fee on 1,000,000 = 20,000
    let expected_fee = 20_000i128;
    let actual_fee = oft_receipt.amount_sent_ld - oft_receipt.amount_received_ld;
    assert_eq!(actual_fee, expected_fee);

    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);
    send_with_fee(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt, &chain_a.fee_collector);

    // IMPORTANT: Scan events immediately after send, before any other operations
    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    // Verify fee was collected
    let fee_collector_balance = token_balance(&env, &chain_a.oft_token, &chain_a.fee_collector);
    assert_eq!(fee_collector_balance, expected_fee);

    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    // Verify receiver got correct amount
    let receiver_balance = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(receiver_balance, oft_receipt.amount_received_ld);
}
