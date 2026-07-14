use super::test_utils::OFTTestSetup;
use crate::{
    events::OFTReceived,
    tests::test_utils::{
        create_origin, create_recipient_address, encode_oft_message, encode_oft_message_with_compose,
        generate_g_address, OFTTestSetupBuilder,
    },
    utils::address_payload,
};
use endpoint_v2::LayerZeroReceiverClient;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};
use utils::testing_utils::assert_contains_event;

// Helper function to reduce code duplication for lz_receive tests
fn run_lz_receive_test(setup: &OFTTestSetup, recipient: &Address, amount_sd: u64) {
    let env = setup.env;
    let executor = Address::generate(env);

    let src_eid = 100u32;
    let peer = BytesN::from_array(env, &[2u8; 32]);
    setup.set_peer(src_eid, &peer);

    // Check initial balance
    let initial_balance = setup.token_client.balance(recipient);
    let initial_oft_balance =
        if setup.is_lock_unlock() { Some(setup.token_client.balance(&setup.oft.address)) } else { None };

    // Create OFT message
    let recipient_bytes32 = address_payload(env, recipient);
    let message = encode_oft_message(env, &recipient_bytes32, amount_sd);

    let guid = BytesN::from_array(env, &[1u8; 32]);
    let origin = create_origin(src_eid, &peer, 1);
    let extra_data = Bytes::new(env);

    // Verify recipient received tokens
    let conversion_rate = setup.oft.decimal_conversion_rate();
    let expected_amount_ld = (amount_sd as i128) * conversion_rate;
    setup.lz_receive(&executor, &origin, &guid, &message, &extra_data, 0);
    assert_contains_event(
        env,
        &setup.oft.address,
        OFTReceived { guid: guid.clone(), src_eid, to: recipient.clone(), amount_received_ld: expected_amount_ld },
    );
    if setup.issuer == *recipient {
        assert_eq!(setup.token_client.balance(recipient), i64::MAX as i128);
    } else {
        assert_eq!(setup.token_client.balance(recipient), initial_balance + expected_amount_ld);
    }

    // For LockUnlock strategy, verify OFT contract balance decreased
    if let Some(initial_oft) = initial_oft_balance {
        assert_eq!(setup.token_client.balance(&setup.oft.address), initial_oft - expected_amount_ld);
    }
}

// ==================== MintBurn Strategy Tests ====================

#[test]
fn test_mint_burn_sac_lz_receive_to_c_address() {
    let env = Env::default();
    let recipient = create_recipient_address(&env);
    let setup = OFTTestSetupBuilder::new(&env).with_sac().build();
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
fn test_mint_burn_contract_token_lz_receive_to_c_address() {
    let env = Env::default();
    let recipient = create_recipient_address(&env);
    let setup = OFTTestSetup::new(&env);
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #13)")] // trustline entry is missing for account
fn test_mint_burn_sac_lz_receive_to_g_address_with_no_trustline() {
    let env = Env::default();
    let recipient = generate_g_address(&env);
    let setup = OFTTestSetupBuilder::new(&env).with_sac().build();
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #2)")] // operation invalid on issuer
fn test_mint_burn_sac_lz_receive_to_issuer() {
    let env = Env::default();
    let setup = OFTTestSetupBuilder::new(&env).with_sac().build();
    run_lz_receive_test(&setup, &setup.issuer, 1_000_000u64);
}

#[test]
fn test_mint_burn_contract_token_lz_receive_to_g_address() {
    let env = Env::default();
    let recipient = generate_g_address(&env);
    let setup = OFTTestSetup::new(&env);
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
fn test_mint_burn_lz_receive_with_compose() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let executor = Address::generate(&env);
    let recipient = create_recipient_address(&env);
    let sender_on_src = Address::generate(&env);

    let src_eid = 100u32;
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    setup.set_peer(src_eid, &peer);

    // Create OFT message with compose
    let recipient_bytes32 = address_payload(&env, &recipient);
    let compose_from = address_payload(&env, &sender_on_src);
    let compose_msg = Bytes::from_array(&env, b"test compose payload");
    let amount_sd = 1000000u64;
    let message = encode_oft_message_with_compose(&env, &recipient_bytes32, amount_sd, &compose_from, &compose_msg);

    let guid = BytesN::from_array(&env, &[1u8; 32]);
    let origin = create_origin(src_eid, &peer, 1);
    let extra_data = Bytes::new(&env);

    // Verify compose not called yet
    assert!(!setup.endpoint_client.was_composed());

    // Execute lz_receive
    setup.lz_receive(&executor, &origin, &guid, &message, &extra_data, 0);

    // Verify tokens were credited
    let conversion_rate = setup.oft.decimal_conversion_rate();
    let expected_amount_ld = (amount_sd as i128) * conversion_rate;
    assert_eq!(setup.token_client.balance(&recipient), expected_amount_ld);

    // Verify compose was called
    assert!(setup.endpoint_client.was_composed());

    // Verify compose recipient
    let compose_to = setup.endpoint_client.get_compose_to().unwrap();
    assert_eq!(compose_to, recipient);
}

#[test]
fn test_mint_burn_lz_receive_zero_amount() {
    let env = Env::default();
    let recipient = create_recipient_address(&env);
    let setup = OFTTestSetup::new(&env);
    run_lz_receive_test(&setup, &recipient, 0u64);
}

// ==================== Lock/Unlock Strategy Tests ====================

#[test]
fn test_lock_unlock_sac_lz_receive_to_c_address() {
    let env = Env::default();
    let recipient = create_recipient_address(&env);
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().with_sac().build();
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
fn test_lock_unlock_contract_token_lz_receive_to_c_address() {
    let env = Env::default();
    let recipient = create_recipient_address(&env);
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().build();
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #13)")] // trustline entry is missing for account
fn test_lock_unlock_sac_lz_receive_to_g_address_with_no_trustline() {
    let env = Env::default();
    let recipient = generate_g_address(&env);
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().with_sac().build();
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
fn test_lock_unlock_sac_lz_receive_to_issuer() {
    let env = Env::default();
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().with_sac().build();
    run_lz_receive_test(&setup, &setup.issuer, 1_000_000u64);
}

#[test]
fn test_lock_unlock_contract_token_lz_receive_to_g_address() {
    let env = Env::default();
    let recipient = generate_g_address(&env);
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().build();
    run_lz_receive_test(&setup, &recipient, 1_000_000u64);
}

#[test]
fn test_lock_unlock_lz_receive_with_compose() {
    let env = Env::default();
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().build();

    let executor = Address::generate(&env);
    let recipient = create_recipient_address(&env);
    let sender_on_src = Address::generate(&env);

    let src_eid = 100u32;
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    setup.set_peer(src_eid, &peer);

    // Create OFT message with compose
    let recipient_bytes32 = address_payload(&env, &recipient);
    let compose_from = address_payload(&env, &sender_on_src);
    let compose_msg = Bytes::from_array(&env, b"test compose payload");
    let amount_sd = 1000000u64;
    let message = encode_oft_message_with_compose(&env, &recipient_bytes32, amount_sd, &compose_from, &compose_msg);

    let guid = BytesN::from_array(&env, &[1u8; 32]);
    let origin = create_origin(src_eid, &peer, 1);
    let extra_data = Bytes::new(&env);

    // Verify compose not called yet
    assert!(!setup.endpoint_client.was_composed());

    // Execute lz_receive
    setup.lz_receive(&executor, &origin, &guid, &message, &extra_data, 0);

    // Verify tokens were credited
    let conversion_rate = setup.oft.decimal_conversion_rate();
    let expected_amount_ld = (amount_sd as i128) * conversion_rate;
    assert_eq!(setup.token_client.balance(&recipient), expected_amount_ld);

    // Verify compose was called
    assert!(setup.endpoint_client.was_composed());

    // Verify compose recipient
    let compose_to = setup.endpoint_client.get_compose_to().unwrap();
    assert_eq!(compose_to, recipient);
}

#[test]
fn test_lock_unlock_lz_receive_zero_amount() {
    let env = Env::default();
    let recipient = create_recipient_address(&env);
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().build();
    run_lz_receive_test(&setup, &recipient, 0u64);
}

// ==================== Authorizations Tests ====================

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_lz_receive_without_giving_authorization() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let executor = Address::generate(&env);
    let recipient = create_recipient_address(&env);

    // Set peer
    let src_eid = 100u32;
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    setup.set_peer(src_eid, &peer);

    // Check initial balance
    assert_eq!(setup.token_client.balance(&recipient), 0);

    // Create OFT message
    let recipient_bytes32 = address_payload(&env, &recipient);
    let amount_sd = 1000000u64; // 1 token in shared decimals
    let message = encode_oft_message(&env, &recipient_bytes32, amount_sd);

    // Create origin
    let guid = BytesN::from_array(&env, &[1u8; 32]);
    let origin = create_origin(src_eid, &peer, 1);
    let extra_data = Bytes::new(&env);

    // Execute lz_receive
    LayerZeroReceiverClient::new(setup.env, &setup.oft.address).lz_receive(
        &executor,
        &origin,
        &guid,
        &message,
        &extra_data,
        &0i128,
    );
}
