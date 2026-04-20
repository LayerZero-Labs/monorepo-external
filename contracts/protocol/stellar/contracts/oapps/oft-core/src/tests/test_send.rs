use crate::{
    errors::OFTError,
    events::OFTSent,
    tests::test_utils::OFTTestSetupBuilder,
    types::{OFTReceipt, SendParam},
};
use endpoint_v2::MessagingFee;
use oapp::OAppError;
use soroban_sdk::{
    bytes,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal,
};
use utils::testing_utils::assert_contains_event;

use super::test_utils::{create_send_param, OFTTestSetup};

// ==================== Basic Send Tests ====================

#[test]
fn test_send_basic() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let refund_address = sender.clone();
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    // Send tokens
    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &refund_address, &oft_receipt);

    // Verify messaging receipt
    assert!(msg_receipt.nonce > 0);
    assert_eq!(msg_receipt.fee.native_fee, setup.native_fee);

    // Verify OFT receipt
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
    assert_eq!(oft_receipt.amount_received_ld, amount_ld);

    // Verify tokens were burned (MintBurn OFT)
    assert_eq!(setup.token_client.balance(&sender), 0);

    // Verify endpoint was called
    assert!(setup.endpoint_client.was_sent());
    assert_eq!(setup.endpoint_client.get_last_dst_eid(), Some(dst_eid));
}

#[test]
fn test_send_burns_tokens() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Fund more tokens than we'll send
    let initial_balance = 100_000_000i128;
    let send_amount = 50_000_000i128;
    setup.fund_tokens(&sender, initial_balance);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, send_amount, send_amount);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    setup.send(&sender, &send_param, &fee, &sender, &oft_receipt);

    // Verify only sent amount was burned
    assert_eq!(setup.token_client.balance(&sender), initial_balance - send_amount);
}

#[test]
fn test_send_with_dust_removal() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Amount with dust (last digit will be removed)
    let amount_with_dust = 12345678i128;
    let expected_dust_removed = 12345670i128;

    setup.fund_tokens(&sender, amount_with_dust);
    setup.fund_native_fees(&sender, setup.native_fee);

    // min_amount_ld should be the dust-removed amount
    let send_param = create_send_param(&env, dst_eid, amount_with_dust, expected_dust_removed);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (_, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    // Verify dust was removed
    assert_eq!(oft_receipt.amount_sent_ld, expected_dust_removed);
    assert_eq!(oft_receipt.amount_received_ld, expected_dust_removed);

    // Only dust-removed amount should be burned
    assert_eq!(setup.token_client.balance(&sender), amount_with_dust - expected_dust_removed);
}

// ==================== Slippage Tests ====================

#[test]
fn test_send_slippage_exactly_met() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    // min_amount_ld exactly equals amount after dust removal
    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (_, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    assert_eq!(oft_receipt.amount_received_ld, amount_ld);
}

#[test]
fn test_send_slippage_exceeded() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Amount with dust that will be removed
    let amount_with_dust = 12345678i128;
    // min_amount_ld higher than what will be received after dust removal
    let min_amount_too_high = 12345678i128; // Same as input, but dust will be removed

    setup.fund_tokens(&sender, amount_with_dust);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, amount_with_dust, min_amount_too_high);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    // Use a receipt with dust-removed amount for auth (even though it will fail slippage check)
    let quoted_receipt = setup.quote_oft(&sender, &create_send_param(&env, dst_eid, amount_with_dust, 0));

    // Should fail due to slippage
    let result = setup.try_send(&sender, &send_param, &fee, &sender, &quoted_receipt);
    assert_eq!(result.err().unwrap().ok().unwrap(), OFTError::SlippageExceeded.into());
}

#[test]
fn test_send_slippage_less_than_received() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    // min_amount_ld less than what will be received
    let min_amount_low = 10000000i128;

    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, min_amount_low);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (_, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    // Should succeed, receiving more than minimum
    assert!(oft_receipt.amount_received_ld >= min_amount_low);
    assert_eq!(oft_receipt.amount_received_ld, amount_ld);
}

// ==================== Error Cases ====================

#[test]
fn test_send_no_peer_set() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);
    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    // Don't set peer - should fail
    let send_param = create_send_param(&env, 100, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    // Create a dummy receipt for auth (will fail before burn anyway)
    let dummy_receipt = OFTReceipt { amount_sent_ld: amount_ld, amount_received_ld: amount_ld };

    let result = setup.try_send(&sender, &send_param, &fee, &sender, &dummy_receipt);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::NoPeer.into());
}

#[test]
fn test_send_zero_amount() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Fund native fees for sending
    setup.fund_native_fees(&sender, setup.native_fee);

    // Send zero tokens
    let send_param = create_send_param(&env, dst_eid, 0, 0);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (_, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    assert_eq!(oft_receipt.amount_sent_ld, 0);
    assert_eq!(oft_receipt.amount_received_ld, 0);
}

#[test]
#[should_panic] // just should_panic since SAC and openzeppelin has a different error message
fn test_send_negative_amount() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Fund some tokens and native fees (though sending negative should fail regardless)
    let initial_balance = 100_000_000i128;
    setup.fund_tokens(&sender, initial_balance);
    setup.fund_native_fees(&sender, setup.native_fee);

    // Attempt to send negative amount - should fail
    // Since Stellar uses i128 for amounts, we test that negative values are properly rejected
    let negative_amount = -12345670i128;
    let send_param = create_send_param(&env, dst_eid, negative_amount, negative_amount);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    // Create a dummy receipt (will panic before this matters)
    let dummy_receipt = OFTReceipt { amount_sent_ld: negative_amount, amount_received_ld: negative_amount };

    // This should panic because the token contract rejects negative amounts for burn
    setup.send(&sender, &send_param, &fee, &sender, &dummy_receipt);
}

// ==================== Compose Message Tests ====================

#[test]
fn test_send_with_compose_msg() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    // Create send param with compose message
    let send_param = SendParam {
        dst_eid,
        to: BytesN::from_array(&env, &[1u8; 32]),
        amount_ld,
        min_amount_ld: amount_ld,
        extra_options: bytes!(&env),
        compose_msg: Bytes::from_array(&env, b"test compose message"),
        oft_cmd: bytes!(&env),
    };

    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    // Verify send succeeded
    assert!(msg_receipt.nonce > 0);
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);

    // Verify tokens were burned
    assert_eq!(setup.token_client.balance(&sender), 0);
}

// ==================== Event Tests ====================

#[test]
fn test_send_emits_oft_sent_event() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    // Assert OFTSent event was emitted with correct values
    assert_contains_event(
        &env,
        &setup.oft.address,
        OFTSent {
            guid: msg_receipt.guid,
            dst_eid,
            from: sender,
            amount_sent_ld: oft_receipt.amount_sent_ld,
            amount_received_ld: oft_receipt.amount_received_ld,
        },
    );
}

// ==================== Multiple Sends Tests ====================

#[test]
fn test_send_multiple_times() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Fund enough for multiple sends
    let total_amount = 100_000_000i128;
    let send_amounts = [10_000_000i128, 20_000_000, 30_000_000];

    setup.fund_tokens(&sender, total_amount);
    setup.fund_native_fees(&sender, setup.native_fee * send_amounts.len() as i128);

    let mut total_sent = 0i128;

    for amount in send_amounts.iter() {
        let send_param = create_send_param(&env, dst_eid, *amount, *amount);
        let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
        let quoted_receipt = setup.quote_oft(&sender, &send_param);

        let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

        assert_eq!(oft_receipt.amount_sent_ld, *amount);
        assert!(msg_receipt.nonce > 0);

        total_sent += amount;
    }

    // Verify remaining balance
    assert_eq!(setup.token_client.balance(&sender), total_amount - total_sent);
}

#[test]
fn test_send_to_multiple_destinations() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set up multiple peers
    let dst_eids = [1u32, 100, 200, 300];
    for eid in dst_eids.iter() {
        let peer = BytesN::from_array(&env, &[*eid as u8; 32]);
        setup.set_peer(*eid, &peer);
    }

    // Fund enough for multiple sends
    let total_amount = 100_000_000i128;
    setup.fund_tokens(&sender, total_amount);
    setup.fund_native_fees(&sender, setup.native_fee * dst_eids.len() as i128);

    let amount_per_send = 10_000_000i128;
    let mut total_sent = 0i128;

    for dst_eid in dst_eids.iter() {
        let send_param = create_send_param(&env, *dst_eid, amount_per_send, amount_per_send);
        let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
        let quoted_receipt = setup.quote_oft(&sender, &send_param);

        let (_, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

        assert_eq!(oft_receipt.amount_sent_ld, amount_per_send);
        assert_eq!(setup.endpoint_client.get_last_dst_eid(), Some(*dst_eid));

        total_sent += amount_per_send;
    }

    // Verify remaining balance
    assert_eq!(setup.token_client.balance(&sender), total_amount - total_sent);
}

// ==================== Different Amounts Tests ====================

#[test]
fn test_send_different_amounts() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Test with different amounts (all divisible by 10 to avoid dust with SAC's 7 decimals)
    let test_amounts = [10i128, 100, 1000, 10000, 100000, 1_000_000, 10_000_000];

    for amount in test_amounts.iter() {
        // Generate new sender for each test
        let test_sender = Address::generate(&env);
        setup.fund_tokens(&test_sender, *amount);
        setup.fund_native_fees(&test_sender, setup.native_fee);

        let send_param = create_send_param(&env, dst_eid, *amount, *amount);
        let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
        let quoted_receipt = setup.quote_oft(&test_sender, &send_param);

        let (_, oft_receipt) = setup.send(&test_sender, &send_param, &fee, &test_sender, &quoted_receipt);

        assert_eq!(oft_receipt.amount_sent_ld, *amount);
        assert_eq!(oft_receipt.amount_received_ld, *amount);
        assert_eq!(setup.token_client.balance(&test_sender), 0);
    }
}

#[test]
fn test_send_large_amount() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Large but valid amount (within safe limits)
    // Conversion rate is 10, so max_sd = u64::MAX, max_ld = u64::MAX * 10
    // Use a reasonably large amount
    let large_amount = 1_000_000_000_000_000i128; // 1 quadrillion in local decimals

    setup.fund_tokens(&sender, large_amount);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, large_amount, large_amount);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (_, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    assert_eq!(oft_receipt.amount_sent_ld, large_amount);
    assert_eq!(setup.token_client.balance(&sender), 0);
}

// ==================== Fee Tests ====================

#[test]
fn test_send_with_zro_fee() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    setup.fund_zro_fees(&sender, setup.zro_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    // Include ZRO fee
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: setup.zro_fee };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    // Verify receipts
    assert!(msg_receipt.nonce > 0);
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
    assert_eq!(setup.token_client.balance(&sender), 0);
}

#[test]
fn test_send_with_custom_fees() {
    let env = Env::default();
    let custom_native_fee = 2000i128;
    let custom_zro_fee = 750i128;
    let setup = OFTTestSetupBuilder::new(&env).with_fees(custom_native_fee, custom_zro_fee).build();

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, custom_native_fee);
    setup.fund_zro_fees(&sender, custom_zro_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: custom_native_fee, zro_fee: custom_zro_fee };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &sender, &quoted_receipt);

    // Verify receipts with custom fees
    assert!(msg_receipt.nonce > 0);
    assert_eq!(msg_receipt.fee.native_fee, custom_native_fee);
    assert_eq!(msg_receipt.fee.zro_fee, custom_zro_fee);
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
}

// ==================== Refund Address Tests ====================

#[test]
fn test_send_with_different_refund_address() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);
    let refund_address = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let quoted_receipt = setup.quote_oft(&sender, &send_param);

    // Use different refund address
    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &refund_address, &quoted_receipt);

    // Send should still succeed
    assert!(msg_receipt.nonce > 0);
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
    assert_eq!(setup.token_client.balance(&sender), 0);
}

// ==================== Lock/Unlock Strategy Tests ====================

#[test]
fn test_send_lock_unlock_strategy() {
    let env = Env::default();
    let setup = OFTTestSetupBuilder::new(&env).lock_unlock().build();

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let refund_address = sender.clone();
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    // Send tokens
    let (msg_receipt, oft_receipt) = setup.send(&sender, &send_param, &fee, &refund_address, &oft_receipt);

    // Verify messaging receipt
    assert!(msg_receipt.nonce > 0);
    assert_eq!(msg_receipt.fee.native_fee, setup.native_fee);

    // Verify OFT receipt
    assert_eq!(oft_receipt.amount_sent_ld, amount_ld);
    assert_eq!(oft_receipt.amount_received_ld, amount_ld);

    // Verify tokens were burned (MintBurn OFT)
    assert_eq!(setup.token_client.balance(&sender), 0);

    // Verify endpoint was called
    assert!(setup.endpoint_client.was_sent());
    assert_eq!(setup.endpoint_client.get_last_dst_eid(), Some(dst_eid));
}

// ==================== Authorizations Tests ====================

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_send_without_giving_authorization() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let refund_address = sender.clone();

    // Send tokens
    setup.oft.send(&sender, &send_param, &fee, &refund_address);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_giving_partial_authorization_without_burn() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let refund_address = sender.clone();

    // Send tokens
    env.mock_auths(&[MockAuth {
        address: &sender,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "send",
            args: (&sender, &send_param, &fee, &refund_address).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    setup.oft.send(&sender, &send_param, &fee, &refund_address);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_giving_partial_authorization_with_burn_wrong_arguments() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let refund_address = sender.clone();
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    // Send tokens
    env.mock_auths(&[MockAuth {
        address: &sender,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "send",
            args: (&sender, &send_param, &fee, &refund_address).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &setup.token,
                fn_name: "burn",
                args: (&sender, &oft_receipt.amount_received_ld + 1).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    setup.oft.send(&sender, &send_param, &fee, &refund_address);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_giving_partial_authorization_without_native_fee_authorizations() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let fee = MessagingFee { native_fee: setup.native_fee, zro_fee: 0 };
    let refund_address = sender.clone();
    let oft_receipt = setup.quote_oft(&sender, &send_param);

    // Send tokens
    env.mock_auths(&[MockAuth {
        address: &sender,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "send",
            args: (&sender, &send_param, &fee, &refund_address).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &setup.token,
                fn_name: "burn",
                args: (&sender, &oft_receipt.amount_received_ld).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    setup.oft.send(&sender, &send_param, &fee, &refund_address);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_giving_partial_authorization_without_zro_fee_authorizations() {
    let env = Env::default();
    let setup = OFTTestSetupBuilder::new(&env).with_native_fee(2).with_zro_fee(1).build();

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let refund_address = sender.clone();
    let oft_receipt = setup.quote_oft(&sender, &send_param);
    let fee = setup.oft.quote_send(&sender, &send_param, &true);

    // Send tokens
    env.mock_auths(&[MockAuth {
        address: &sender,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "send",
            args: (&sender, &send_param, &fee, &refund_address).into_val(&env),
            sub_invokes: &[
                MockAuthInvoke {
                    contract: &setup.token,
                    fn_name: "burn",
                    args: (&sender, &oft_receipt.amount_received_ld).into_val(&env),
                    sub_invokes: &[],
                },
                MockAuthInvoke {
                    contract: &setup.native_token,
                    fn_name: "transfer",
                    args: (&sender, &setup.endpoint_client.address, &fee.native_fee).into_val(&env),
                    sub_invokes: &[],
                },
            ],
        },
    }]);
    setup.oft.send(&sender, &send_param, &fee, &refund_address);
}

#[test]
fn test_giving_full_authorization() {
    let env = Env::default();
    let setup = OFTTestSetupBuilder::new(&env).with_native_fee(2).with_zro_fee(1).build();

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;

    // Fund sender with tokens and native fees
    setup.fund_tokens(&sender, amount_ld);
    setup.fund_native_fees(&sender, setup.native_fee);
    setup.fund_zro_fees(&sender, setup.zro_fee);
    assert_eq!(setup.token_client.balance(&sender), amount_ld);

    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
    let refund_address = sender.clone();
    let oft_receipt = setup.quote_oft(&sender, &send_param);
    let fee = setup.oft.quote_send(&sender, &send_param, &true);

    // Send tokens
    env.mock_auths(&[MockAuth {
        address: &sender,
        invoke: &MockAuthInvoke {
            contract: &setup.oft.address,
            fn_name: "send",
            args: (&sender, &send_param, &fee, &refund_address).into_val(&env),
            sub_invokes: &[
                MockAuthInvoke {
                    contract: &setup.token,
                    fn_name: "burn",
                    args: (&sender, &oft_receipt.amount_received_ld).into_val(&env),
                    sub_invokes: &[],
                },
                MockAuthInvoke {
                    contract: &setup.native_token,
                    fn_name: "transfer",
                    args: (&sender, &setup.endpoint_client.address, &fee.native_fee).into_val(&env),
                    sub_invokes: &[],
                },
                MockAuthInvoke {
                    contract: &setup.zro_token,
                    fn_name: "transfer",
                    args: (&sender, &setup.endpoint_client.address, &fee.zro_fee).into_val(&env),
                    sub_invokes: &[],
                },
            ],
        },
    }]);
    setup.oft.send(&sender, &send_param, &fee, &refund_address);
}
