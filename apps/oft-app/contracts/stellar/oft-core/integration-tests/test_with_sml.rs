use core::ops::Mul;

use soroban_sdk::{bytes, log, testutils::Address as _, token::TokenClient, Address, Bytes, Env};

use crate::{
    codec::{oft_compose_msg_codec::OFTComposeMsg, oft_msg_codec},
    integration_tests::{
        setup::{decode_packet, setup, wire_endpoint, wire_oft, TestSetup},
        utils::{
            lz_compose, lz_receive, mint_to, quote_oft, quote_send, scan_packet_sent_event, send, transfer_sac_admin,
            validate_packet,
        },
    },
    tests::test_utils::create_recipient_address,
    types::SendParam,
    utils::address_payload,
};

#[test]
fn test_send_vanilla() {
    let TestSetup { env, chain_a, chain_b } = setup();

    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    // Register a dummy contract for the receiver so it passes the .exists() check
    let receiver = create_recipient_address(&env);
    log!(&env, "sender: {:?}", sender);
    log!(&env, "receiver: {:?}", receiver);

    // mint tokens and transfer oft token admin rights
    mint_to(&env, &chain_a.owner, &chain_a.oft_token, &sender, 10e7 as i128);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10e18 as i128);
    transfer_sac_admin(&env, &chain_a.owner, &chain_a.oft_token, &chain_a.oft.address);
    transfer_sac_admin(&env, &chain_b.owner, &chain_b.oft_token, &chain_b.oft.address);

    // initial balances
    let sender_balance_chain_a = TokenClient::new(&env, &chain_a.oft_token).balance(&sender);
    let receiver_balance_chain_b = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(sender_balance_chain_a, 10e7 as i128);
    assert_eq!(receiver_balance_chain_b, 0);

    let send_param = SendParam {
        dst_eid: chain_b.eid,
        to: address_payload(&env, &receiver),
        amount_ld: 10e7 as i128,
        min_amount_ld: 10e7 as i128,
        extra_options: bytes!(&env),
        compose_msg: bytes!(&env),
        oft_cmd: bytes!(&env),
    };
    log!(&env, "send_param: {:?}", send_param);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    log!(&env, "oft_receipt: {:?}", oft_receipt);

    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);
    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    // deliver the message on Chain B and execute lz_receive
    let executor = Address::generate(&env);
    log!(&env, "executor: {:?}", executor);
    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    // assertions
    let sender_balance_chain_a = TokenClient::new(&env, &chain_a.oft_token).balance(&sender);
    let receiver_balance_chain_b = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(sender_balance_chain_a, 0);
    assert_eq!(receiver_balance_chain_b, 10e7 as i128);
}

#[test]
fn test_send_composed() {
    let TestSetup { env, chain_a, chain_b } = setup();

    wire_endpoint(&env, &[&chain_a, &chain_b]);
    wire_oft(&env, &[&chain_a, &chain_b]);

    let sender = Address::generate(&env);
    let receiver = chain_b.composer.address.clone();
    log!(&env, "sender: {:?}", sender);
    log!(&env, "receiver: {:?}", receiver);

    // mint tokens and transfer oft token admin rights
    mint_to(&env, &chain_a.owner, &chain_a.oft_token, &sender, 10e7 as i128);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, 10e18 as i128);
    transfer_sac_admin(&env, &chain_a.owner, &chain_a.oft_token, &chain_a.oft.address);
    transfer_sac_admin(&env, &chain_b.owner, &chain_b.oft_token, &chain_b.oft.address);

    // initial balances
    let sender_balance_chain_a = TokenClient::new(&env, &chain_a.oft_token).balance(&sender);
    let receiver_balance_chain_b = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(sender_balance_chain_a, 10e7 as i128);
    assert_eq!(receiver_balance_chain_b, 0);

    let send_param = SendParam {
        dst_eid: chain_b.eid,
        to: address_payload(&env, &receiver),
        amount_ld: 10e7 as i128,
        min_amount_ld: 10e7 as i128,
        extra_options: bytes!(&env),
        compose_msg: Bytes::from_array(&env, b"compose_msg"),
        oft_cmd: bytes!(&env),
    };
    log!(&env, "send_param: {:?}", send_param);
    let (_, _, oft_receipt) = quote_oft(&chain_a, &sender, &send_param);
    log!(&env, "oft_receipt: {:?}", oft_receipt);

    let fee = quote_send(&env, &chain_a, &sender, &send_param, false);
    send(&env, &chain_a, &sender, &send_param, &fee, &sender, &oft_receipt);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    validate_packet(&env, &chain_b, &packet_event);
    let packet = decode_packet(&env, &packet_event.0);

    // deliver the message on Chain B and execute lz_receive
    let executor = Address::generate(&env);
    log!(&env, "executor: {:?}", executor);
    lz_receive(&env, &chain_b, &executor, &packet, &receiver, 0);

    // assertions
    let sender_balance_chain_a = TokenClient::new(&env, &chain_a.oft_token).balance(&sender);
    let receiver_balance_chain_b = TokenClient::new(&env, &chain_b.oft_token).balance(&receiver);
    assert_eq!(sender_balance_chain_a, 0);
    assert_eq!(receiver_balance_chain_b, 10e7 as i128);

    // execute lz_compose
    let extra_data = Bytes::from_array(&env, b"extra data");
    let oft_msg = oft_msg_codec::OFTMessage::decode(&packet.message);
    let compose = oft_msg.compose.unwrap();
    let oft_compose_msg = OFTComposeMsg {
        nonce: packet.nonce,
        src_eid: packet.src_eid,
        amount_ld: (oft_msg.amount_sd as i128).mul(chain_b.oft.decimal_conversion_rate()),
        compose_from: compose.from,
        compose_msg: compose.msg,
    }
    .encode(&env);
    let compose_value = 100;
    let compose_index = 0;
    lz_compose(&env, &chain_b, &executor, &packet, compose_index, &extra_data, compose_value);

    // assertions
    let compose_message = chain_b.composer.compose_message().unwrap();
    assert_eq!(compose_message.executor, executor);
    assert_eq!(compose_message.from, chain_b.oft.address);
    assert_eq!(compose_message.guid, packet.guid);
    assert_eq!(compose_message.index, compose_index);
    assert_eq!(compose_message.message, oft_compose_msg);
    assert_eq!(compose_message.extra_data, extra_data);
    assert_eq!(compose_message.value, compose_value);
}
