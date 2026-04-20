use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN};

use crate::{errors::EndpointError, tests::endpoint_setup::setup, util::compute_guid, MessagingParams};

// Helpers
/// Helper to create default messaging params
fn default_params(env: &soroban_sdk::Env, dst_eid: u32, pay_in_zro: bool) -> MessagingParams {
    MessagingParams {
        dst_eid,
        receiver: BytesN::from_array(env, &[1u8; 32]),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro,
    }
}

// Native Fee Payment
#[test]
fn test_quote_with_native_fee() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 100, 0);

    let params = default_params(env, dst_eid, false);

    let fee = endpoint_client.quote(&sender, &params);
    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 0);
}

// ZRO Fee Payment
#[test]
fn test_quote_with_zro_fee() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_zro_with_auth();
    context.setup_default_send_lib(dst_eid, 50, 25);

    let params = default_params(env, dst_eid, true);

    let fee = endpoint_client.quote(&sender, &params);
    assert_eq!(fee.native_fee, 50);
    assert_eq!(fee.zro_fee, 25);
}

#[test]
fn test_quote_pay_in_zro_false_with_zro_set() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_zro_with_auth(); // Set ZRO but don't use it
    context.setup_default_send_lib(dst_eid, 100, 0);

    let params = default_params(env, dst_eid, false);

    // Should work fine even though ZRO is set, because pay_in_zro is false
    let fee = endpoint_client.quote(&sender, &params);
    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 0);
}

// Send Library Management
#[test]
fn test_quote_with_custom_send_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let fee_recipient = Address::generate(env);

    // Setup default send library with 100 fee
    context.setup_default_send_lib(dst_eid, 100, 0);

    // Setup custom send library with 200 fee
    let custom_lib = context.setup_mock_send_lib(vec![env, dst_eid], 200, 0, fee_recipient);
    context.register_library_with_auth(&custom_lib);

    // Set custom library for sender
    let custom_lib_option = Some(custom_lib.clone());
    context.mock_auth(&sender, "set_send_library", (&sender, &sender, &dst_eid, &custom_lib_option));
    endpoint_client.set_send_library(&sender, &sender, &dst_eid, &Some(custom_lib));

    let params = default_params(env, dst_eid, false);

    let fee = endpoint_client.quote(&sender, &params);
    // Should use custom library with 200 fee
    assert_eq!(fee.native_fee, 200);
    assert_eq!(fee.zro_fee, 0);
}

// Error Cases
#[test]
fn test_quote_zro_unavailable_when_pay_in_zro() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 999u32; // Use unique dst_eid to avoid conflicts

    // Verify ZRO is not set
    let zro_token = endpoint_client.zro();
    assert_eq!(zro_token, None, "ZRO must not be set for this test");

    // DO NOT setup send library - the ZRO check happens FIRST (line 44), before get_send_library is called
    // So we should get ZROUnavailable error, not DefaultSendLibUnavailable
    let params = default_params(env, dst_eid, true);

    let result = endpoint_client.try_quote(&sender, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ZroUnavailable.into());
}

#[test]
fn test_quote_default_send_lib_unavailable() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 999u32; // Use unique dst_eid that has no default send library

    // Verify no default send library is set
    let default_send_lib = context.endpoint_client.default_send_library(&dst_eid);
    assert_eq!(default_send_lib, None, "Default send library should not be set for this test");

    let params = default_params(env, dst_eid, false);

    // Should fail with DefaultSendLibUnavailable since no default send library is set
    let result = endpoint_client.try_quote(&sender, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::DefaultSendLibUnavailable.into());
}

// Edge Cases
#[test]
fn test_quote_with_empty_message_and_options() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 100, 0);

    let params = MessagingParams {
        dst_eid,
        receiver: BytesN::from_array(env, &[1u8; 32]),
        message: Bytes::new(env), // Empty message
        options: Bytes::new(env),
        pay_in_zro: false,
    };

    // Should work fine with empty message
    let fee = endpoint_client.quote(&sender, &params);
    assert_eq!(fee.native_fee, 100);
}

#[test]
fn test_quote_with_non_empty_options() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 100, 0);

    // Create non-empty options (simulating executor/DVN options)
    // Format: [worker_id (1 byte), option_size (2 bytes), option_data...]
    let options = Bytes::from_array(env, &[1u8, 0u8, 4u8, 1u8, 2u8, 3u8, 4u8]);

    let params = MessagingParams {
        dst_eid,
        receiver: BytesN::from_array(env, &[1u8; 32]),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options,
        pay_in_zro: false,
    };

    // Should work fine with non-empty options
    let fee = endpoint_client.quote(&sender, &params);
    assert_eq!(fee.native_fee, 100);
}

#[test]
fn test_quote_with_different_dst_eid() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid_1 = 2u32;
    let dst_eid_2 = 3u32;

    // Setup different send libraries for different dst_eids
    context.setup_default_send_lib(dst_eid_1, 100, 0);
    context.setup_default_send_lib(dst_eid_2, 200, 0);

    let params_1 = default_params(env, dst_eid_1, false);
    let fee_1 = endpoint_client.quote(&sender, &params_1);
    assert_eq!(fee_1.native_fee, 100);

    let params_2 = default_params(env, dst_eid_2, false);
    let fee_2 = endpoint_client.quote(&sender, &params_2);
    assert_eq!(fee_2.native_fee, 200);
}

#[test]
fn test_quote_with_different_receivers() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 100, 0);

    let receiver_1 = BytesN::from_array(env, &[1u8; 32]);
    let receiver_2 = BytesN::from_array(env, &[2u8; 32]);

    let params_1 = MessagingParams {
        dst_eid,
        receiver: receiver_1,
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };
    let fee_1 = endpoint_client.quote(&sender, &params_1);
    assert_eq!(fee_1.native_fee, 100);

    let params_2 = MessagingParams {
        dst_eid,
        receiver: receiver_2,
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };
    let fee_2 = endpoint_client.quote(&sender, &params_2);
    assert_eq!(fee_2.native_fee, 100);
}

#[test]
fn test_quote_with_different_senders() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender_1 = Address::generate(env);
    let sender_2 = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    context.setup_default_send_lib(dst_eid, 100, 0);

    // Each sender should have independent nonce tracking
    let params_1 = MessagingParams {
        dst_eid,
        receiver: receiver.clone(),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };
    let fee_1 = endpoint_client.quote(&sender_1, &params_1);
    assert_eq!(fee_1.native_fee, 100);

    let params_2 = MessagingParams {
        dst_eid,
        receiver: receiver.clone(),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };
    let fee_2 = endpoint_client.quote(&sender_2, &params_2);
    assert_eq!(fee_2.native_fee, 100);

    // Verify both senders have independent nonces (both should be 0 initially)
    let nonce_1 = endpoint_client.outbound_nonce(&sender_1, &dst_eid, &receiver);
    let nonce_2 = endpoint_client.outbound_nonce(&sender_2, &dst_eid, &receiver);
    assert_eq!(nonce_1, 0);
    assert_eq!(nonce_2, 0);
}

// Large Message Tests
#[test]
fn test_quote_with_large_message() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    context.setup_default_send_lib(dst_eid, 100, 0);

    // Create a large message (1024 bytes)
    let mut large_message_data = [0u8; 1024];
    for i in 0..1024 {
        large_message_data[i] = (i % 256) as u8;
    }
    let large_message = Bytes::from_array(env, &large_message_data);

    let params = MessagingParams {
        dst_eid,
        receiver: BytesN::from_array(env, &[1u8; 32]),
        message: large_message,
        options: Bytes::new(env),
        pay_in_zro: false,
    };

    // Should work fine with large message
    let fee = endpoint_client.quote(&sender, &params);
    assert_eq!(fee.native_fee, 100);
}

// Nonce and GUID Verification
#[test]
fn test_quote_nonce_calculation() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    context.setup_default_send_lib(dst_eid, 100, 0);

    // Initial nonce should be 0
    let initial_nonce = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver);
    assert_eq!(initial_nonce, 0);

    let params = MessagingParams {
        dst_eid,
        receiver: receiver.clone(),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };

    // First quote should use nonce = 0 + 1 = 1
    let _fee_1 = endpoint_client.quote(&sender, &params);
    // Nonce should still be 0 (quote doesn't increment nonce)
    let nonce_after_first = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver);
    assert_eq!(nonce_after_first, 0);

    // Second quote should also use nonce = 0 + 1 = 1 (nonce doesn't change)
    let _fee_2 = endpoint_client.quote(&sender, &params);
    let nonce_after_second = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver);
    assert_eq!(nonce_after_second, 0);
}

#[test]
fn test_quote_guid_calculation() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    context.setup_default_send_lib(dst_eid, 100, 0);

    let params = MessagingParams {
        dst_eid,
        receiver: receiver.clone(),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };

    // Get the expected nonce (outbound_nonce + 1)
    let expected_nonce = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver) + 1;
    let src_eid = endpoint_client.eid();

    // Calculate expected GUID
    let expected_guid = compute_guid(env, expected_nonce, src_eid, &sender, dst_eid, &receiver);

    // Mock the send library to capture the packet
    // Since we can't directly inspect the packet passed to send_lib.quote(),
    // we verify the nonce calculation indirectly by checking that quote works correctly
    // The GUID is computed internally, so we verify the nonce is correct
    let _fee = endpoint_client.quote(&sender, &params);

    // Verify the GUID would be computed correctly by checking next_guid
    let next_guid = endpoint_client.next_guid(&sender, &dst_eid, &receiver);
    assert_eq!(next_guid, expected_guid);
}

#[test]
fn test_quote_multiple_quotes_same_path() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    context.setup_default_send_lib(dst_eid, 100, 0);

    let params = MessagingParams {
        dst_eid,
        receiver: receiver.clone(),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };

    // Multiple quotes for the same path should all use the same nonce (outbound_nonce + 1)
    // because quote doesn't increment the nonce
    for _ in 0..5 {
        let fee = endpoint_client.quote(&sender, &params);
        assert_eq!(fee.native_fee, 100);
    }

    // Nonce should still be 0 (quote doesn't increment it)
    let nonce = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver);
    assert_eq!(nonce, 0);
}

// Quote After Send
#[test]
fn test_quote_after_send() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let refund_address = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    context.setup_default_send_lib(dst_eid, 100, 0);

    // Setup ZRO token (required for send)
    context.setup_zro_with_auth();

    // Mint and transfer native tokens for send
    context.fund_endpoint_with_native(&sender, 100);

    let params = MessagingParams {
        dst_eid,
        receiver: receiver.clone(),
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        options: Bytes::new(env),
        pay_in_zro: false,
    };

    // Send a message (this increments the nonce)
    context.mock_auth(&sender, "send", (&sender, &params, &refund_address));
    let _receipt = endpoint_client.send(&sender, &params, &refund_address);

    // Verify nonce was incremented
    let nonce_after_send = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver);
    assert_eq!(nonce_after_send, 1);

    // Quote should now use nonce = 1 + 1 = 2
    let _fee = endpoint_client.quote(&sender, &params);

    // Verify next_guid uses nonce 2
    let next_guid = endpoint_client.next_guid(&sender, &dst_eid, &receiver);
    let expected_guid = compute_guid(env, 2, endpoint_client.eid(), &sender, dst_eid, &receiver);
    assert_eq!(next_guid, expected_guid);
}
