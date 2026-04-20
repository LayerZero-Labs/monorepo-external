use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN, Env};
use utils::testing_utils::assert_contains_event;

use crate::{
    errors::EndpointError,
    events::PacketSent,
    tests::endpoint_setup::{setup, TestSetup},
    MessagingParams, MessagingReceipt,
};

// Helpers
fn default_params(env: &Env, dst_eid: u32, pay_in_zro: bool) -> MessagingParams {
    MessagingParams {
        dst_eid,
        receiver: BytesN::from_array(env, &[1u8; 32]),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro,
    }
}

fn send_with_auth<'a>(
    context: &TestSetup<'a>,
    sender: &Address,
    params: &MessagingParams,
    refund_address: &Address,
) -> MessagingReceipt {
    context.mock_auth(sender, "send", (sender, params, refund_address));
    context.endpoint_client.send(sender, params, refund_address)
}

// Native Fee Payment
#[test]
fn test_send_with_native_fee_exact_payment() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let dst_eid = 2u32;
    let sender = Address::generate(env);
    let refund_address = Address::generate(env);

    let (send_lib, fee_recipient) = context.setup_default_send_lib(dst_eid, 100, 0);
    context.fund_endpoint_with_native(&sender, 100);

    let params = default_params(env, dst_eid, false);
    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    // Verify receipt
    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 100);
    assert_eq!(receipt.fee.zro_fee, 0);

    // Verify PacketSent event was published
    // MockSendLib::send returns encoded_packet = packet.message.clone()
    assert_contains_event(
        env,
        &endpoint_client.address,
        PacketSent {
            encoded_packet: params.message.clone(),
            options: params.options.clone(),
            send_library: send_lib.clone(),
        },
    );

    // Verify outbound nonce was incremented
    let nonce = endpoint_client.outbound_nonce(&sender, &dst_eid, &params.receiver);
    assert_eq!(nonce, 1);

    // Verify fee was paid to fee_recipient
    assert_eq!(context.native_token_client.balance(&fee_recipient), 100);

    // Verify no refund (exact payment)
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
}

#[test]
fn test_send_with_native_fee_and_refund() {
    let context = setup();
    let env = &context.env;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    let (_, fee_recipient) = context.setup_default_send_lib(dst_eid, 100, 0);

    // Overpay native fees
    context.fund_endpoint_with_native(&sender, 250);
    let params = default_params(env, dst_eid, false);
    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    // Verify receipt
    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 100);

    // Verify fee was paid to fee_recipient
    assert_eq!(context.native_token_client.balance(&fee_recipient), 100);

    // Verify refund (250 - 100 = 150)
    assert_eq!(context.native_token_client.balance(&refund_address), 150);
}

#[test]
fn test_send_insufficient_native_fee() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 100, 0);

    // Fund LESS native than required
    context.fund_endpoint_with_native(&sender, 50);

    let params = default_params(env, dst_eid, false);
    context.mock_auth(&sender, "send", (&sender, &params, &refund_address));
    let result = endpoint_client.try_send(&sender, &params, &refund_address);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InsufficientNativeFee.into());
}

// ZRO Fee Payment
#[test]
fn test_send_with_zro_fee() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_zro_with_auth();
    let (send_lib, fee_recipient) = context.setup_default_send_lib(dst_eid, 50, 25);

    // Fund exact fees
    context.fund_endpoint_with_native(&sender, 50);
    context.fund_endpoint_with_zro(&sender, 25);

    let params = default_params(env, dst_eid, true);
    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    // Verify receipt
    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 50);
    assert_eq!(receipt.fee.zro_fee, 25);

    // Verify PacketSent event was published
    assert_contains_event(
        env,
        &endpoint_client.address,
        PacketSent {
            encoded_packet: params.message.clone(),
            options: params.options.clone(),
            send_library: send_lib.clone(),
        },
    );

    // Verify fees were paid
    assert_eq!(context.native_token_client.balance(&fee_recipient), 50);
    assert_eq!(context.zro_token_client.balance(&fee_recipient), 25);

    // Verify no refunds
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
    assert_eq!(context.zro_token_client.balance(&refund_address), 0);
}

#[test]
fn test_send_with_zro_refund() {
    let context = setup();
    let env = &context.env;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_zro_with_auth();
    let (_, fee_recipient) = context.setup_default_send_lib(dst_eid, 50, 25);

    // Exact native, overpay ZRO to hit refund branch.
    context.fund_endpoint_with_native(&sender, 50);
    context.fund_endpoint_with_zro(&sender, 80);

    let params = default_params(env, dst_eid, true);
    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 50);
    assert_eq!(receipt.fee.zro_fee, 25);

    // Fee recipient got paid
    assert_eq!(context.native_token_client.balance(&fee_recipient), 50);
    assert_eq!(context.zro_token_client.balance(&fee_recipient), 25);

    // Native was exact, ZRO was overpaid => refund 80 - 25 = 55
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
    assert_eq!(context.zro_token_client.balance(&refund_address), 55);
}

#[test]
fn test_send_pay_in_zro_false_without_zro_set() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;

    // Ensure ZRO is not set; pay_in_zro=false should not require it.
    assert_eq!(endpoint_client.zro(), None);

    let (_, fee_recipient) = context.setup_default_send_lib(dst_eid, 100, 0);
    context.fund_endpoint_with_native(&sender, 100);

    let params = default_params(env, dst_eid, false);
    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 100);
    assert_eq!(receipt.fee.zro_fee, 0);
    assert_eq!(context.native_token_client.balance(&fee_recipient), 100);
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
}

#[test]
fn test_send_zro_unavailable_when_pay_in_zro() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);

    // ZRO is intentionally unset
    assert_eq!(endpoint_client.zro(), None);

    // ZRO check happens before send lib resolution; we don't need to setup a send lib.
    let params = default_params(env, 998u32, true);
    context.mock_auth(&sender, "send", (&sender, &params, &refund_address));
    let result = endpoint_client.try_send(&sender, &params, &refund_address);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ZroUnavailable.into());
}

#[test]
fn test_send_zero_zro_fee_when_pay_in_zro_true() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;

    // Set ZRO token so we pass the send() pre-check, but do NOT transfer any ZRO to the endpoint.
    context.setup_zro_with_auth();

    // Configure send lib with zero fees, but pay_in_zro=true triggers the ZeroZROFee guard.
    context.setup_default_send_lib(dst_eid, 0, 0);

    let params = default_params(env, dst_eid, true);
    context.mock_auth(&sender, "send", (&sender, &params, &refund_address));
    let result = endpoint_client.try_send(&sender, &params, &refund_address);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ZeroZroFee.into());
}

#[test]
fn test_send_insufficient_zro_fee() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;

    // Set ZRO token
    context.setup_zro_with_auth();

    // Setup send lib that requires 25 ZRO, 0 native
    context.setup_default_send_lib(dst_eid, 0, 25);

    // Transfer LESS ZRO than needed (only 10)
    context.fund_endpoint_with_zro(&sender, 10);

    let params = default_params(env, dst_eid, true);
    context.mock_auth(&sender, "send", (&sender, &params, &refund_address));
    let result = endpoint_client.try_send(&sender, &params, &refund_address);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InsufficientZroFee.into());
}

// Nonce Management
#[test]
fn test_send_increments_nonce_sequentially() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 50, 0);
    let params = default_params(env, dst_eid, false);

    for expected_nonce in 1..=3u64 {
        context.fund_endpoint_with_native(&sender, 50);
        let receipt = send_with_auth(&context, &sender, &params, &refund_address);
        assert_eq!(receipt.nonce, expected_nonce);
    }

    // Verify final outbound nonce
    let final_nonce = endpoint_client.outbound_nonce(&sender, &dst_eid, &params.receiver);
    assert_eq!(final_nonce, 3);
}

#[test]
fn test_next_guid_matches_send_receipt_guid() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 100, 0);
    let params = default_params(env, dst_eid, false);

    // Get the expected GUID before sending
    let next_guid = endpoint_client.next_guid(&sender, &dst_eid, &params.receiver);

    // Fund endpoint with native fee
    context.fund_endpoint_with_native(&sender, 100);

    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    // Verify the GUID in receipt matches the expected GUID
    assert_eq!(receipt.guid, next_guid);
}

// Receiver Management
#[test]
fn test_send_to_different_receivers() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    let receiver1 = BytesN::from_array(env, &[1u8; 32]);
    let receiver2 = BytesN::from_array(env, &[2u8; 32]);
    context.setup_default_send_lib(dst_eid, 50, 0);

    let mut params1 = default_params(env, dst_eid, false);
    params1.receiver = receiver1.clone();
    context.fund_endpoint_with_native(&sender, 50);
    let receipt1 = send_with_auth(&context, &sender, &params1, &refund_address);

    let mut params2 = default_params(env, dst_eid, false);
    params2.receiver = receiver2.clone();
    context.fund_endpoint_with_native(&sender, 50);
    let receipt2 = send_with_auth(&context, &sender, &params2, &refund_address);

    // Verify each receiver has its own nonce tracking
    assert_eq!(receipt1.nonce, 1);
    assert_eq!(receipt2.nonce, 1); // First message to receiver2

    // Verify outbound nonces are tracked separately per receiver
    let nonce1 = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver1);
    let nonce2 = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver2);
    assert_eq!(nonce1, 1);
    assert_eq!(nonce2, 1);
}

// Send Library Management
#[test]
fn test_send_with_custom_send_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;

    let (_, default_fee_recipient) = context.setup_default_send_lib(dst_eid, 100, 0);

    // Setup custom send library with different fee (200)
    let custom_fee_recipient = Address::generate(env);
    let custom_lib = context.setup_mock_send_lib(vec![&context.env, dst_eid], 200, 0, custom_fee_recipient.clone());
    context.register_library_with_auth(&custom_lib);

    // Set custom library for this sender
    let custom_lib_option = Some(custom_lib.clone());
    context.mock_auth(&sender, "set_send_library", (&sender, &sender, &dst_eid, &custom_lib_option));
    endpoint_client.set_send_library(&sender, &sender, &dst_eid, &custom_lib_option);

    // Fund endpoint with native token for custom library fee
    context.fund_endpoint_with_native(&sender, 200);

    let params = default_params(env, dst_eid, false);
    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    // Verify receipt uses custom library fee (200, not 100)
    assert_eq!(receipt.fee.native_fee, 200);

    // Verify fee was paid to custom_fee_recipient (not default_fee_recipient)
    assert_eq!(context.native_token_client.balance(&custom_fee_recipient), 200);
    assert_eq!(context.native_token_client.balance(&default_fee_recipient), 0);
}

// Options handling
#[test]
fn test_send_with_non_empty_options_emits_event_and_charges_fee() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;

    // Non-empty options (simulating executor/DVN options)
    // Format example: [worker_id (1 byte), option_size (2 bytes), option_data...]
    let options = Bytes::from_array(env, &[1u8, 0u8, 4u8, 9u8, 8u8, 7u8, 6u8]);

    let (send_lib, fee_recipient) = context.setup_default_send_lib(dst_eid, 100, 0);
    context.fund_endpoint_with_native(&sender, 100);

    let mut params = default_params(env, dst_eid, false);
    params.options = options.clone();

    let receipt = send_with_auth(&context, &sender, &params, &refund_address);

    assert_eq!(receipt.nonce, 1);
    assert_eq!(receipt.fee.native_fee, 100);
    assert_eq!(receipt.fee.zro_fee, 0);

    // Verify PacketSent event captures options and encoded packet.
    assert_contains_event(
        env,
        &endpoint_client.address,
        PacketSent { encoded_packet: params.message.clone(), options: options.clone(), send_library: send_lib.clone() },
    );

    // Fee was paid and there was no refund.
    assert_eq!(context.native_token_client.balance(&fee_recipient), 100);
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
}

#[test]
fn test_send_default_send_lib_unavailable() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 999u32; // unique eid with no default send library

    // Ensure no default send library is set
    assert_eq!(endpoint_client.default_send_library(&dst_eid), None);

    let params = default_params(env, dst_eid, false);
    context.mock_auth(&sender, "send", (&sender, &params, &refund_address));
    let result = endpoint_client.try_send(&sender, &params, &refund_address);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::DefaultSendLibUnavailable.into());
}

// Authorization
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_send_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);

    // No mock auth for `sender` => should panic on `sender.require_auth()`
    let params = default_params(env, 2u32, false);
    endpoint_client.send(&sender, &params, &refund_address);
}
