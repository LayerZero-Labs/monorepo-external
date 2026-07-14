use crate::{
    codec::MsgType,
    integration_tests::{setup_sml::*, utils::*},
    tests::mint_to,
};
use soroban_sdk::{testutils::Address as _, Address, Bytes};

#[test]
fn test_increment_vanilla() {
    let TestSetup { env, chain_a, chain_b } = wired_setup();

    let sender = Address::generate(&env);
    let options = Bytes::new(&env);
    let fee = quote(&chain_a, chain_b.eid, MsgType::Vanilla, &options);

    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, MsgType::Vanilla, &options, &fee);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet = validate_packet(&env, &chain_b, &packet_event);

    let executor = Address::generate(&env);
    lz_receive(&env, &chain_b, &executor, &packet, 0);

    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
}

#[test]
fn test_increment_aba() {
    let TestSetup { env, chain_a, chain_b } = wired_setup();

    let sender = Address::generate(&env);
    let msg_type = MsgType::ABA;
    let options = Bytes::new(&env);

    let fee = quote(&chain_a, chain_b.eid, msg_type, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, msg_type, &options, &fee);

    // validate packet on Chain B
    let packet_event_chain_a = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet_chain_a = validate_packet(&env, &chain_b, &packet_event_chain_a);

    // deliver the message on Chain B and execute lz_receive
    let executor = Address::generate(&env);
    lz_receive(&env, &chain_b, &executor, &packet_chain_a, fee.native_fee);

    // validate packet on Chain A
    let packet_event_chain_b = scan_packet_sent_event(&env, &chain_b.endpoint.address).unwrap();
    let packet_chain_b = validate_packet(&env, &chain_a, &packet_event_chain_b);

    // deliver the message on Chain A and execute lz_receive
    lz_receive(&env, &chain_a, &executor, &packet_chain_b, fee.native_fee);

    // state assertion
    assert_eq!(chain_a.counter.count(), 1);
    assert_eq!(chain_a.counter.inbound_count(&chain_b.eid), 1);
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);

    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
}

#[test]
fn test_increment_composed() {
    let TestSetup { env, chain_a, chain_b } = wired_setup();

    let sender = Address::generate(&env);
    let msg_type = MsgType::Composed;
    let options = Bytes::new(&env);

    let fee = quote(&chain_a, chain_b.eid, msg_type, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, msg_type, &options, &fee);

    // validate packet on Chain B
    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet = validate_packet(&env, &chain_b, &packet_event);

    // deliver the message on Chain B and execute lz_receive
    let executor = Address::generate(&env);
    lz_receive(&env, &chain_b, &executor, &packet, 0);

    // execute lz_compose
    lz_compose(&env, &chain_b, &executor, &packet, 0);

    // state assertion
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
    assert_eq!(chain_b.counter.composed_count(), 1);
}

#[test]
fn test_increment_composed_aba() {
    let TestSetup { env, chain_a, chain_b } = wired_setup();

    let sender = Address::generate(&env);
    let msg_type = MsgType::ComposedABA;
    let options = Bytes::new(&env);

    let fee = quote(&chain_a, chain_b.eid, msg_type, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, msg_type, &options, &fee);

    // validate packet on Chain B
    let packet_event_chain_a = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet_chain_a = validate_packet(&env, &chain_b, &packet_event_chain_a);

    // deliver the message on Chain B and execute lz_receive
    let executor = Address::generate(&env);
    lz_receive(&env, &chain_b, &executor, &packet_chain_a, 0);
    // supply native token for lz_send(inside lz_compose) on Chain B
    lz_compose(&env, &chain_b, &executor, &packet_chain_a, fee.native_fee);

    // validate packet on Chain A(packet emitted on Chain B)
    let packet_event_chain_b = scan_packet_sent_event(&env, &chain_b.endpoint.address).unwrap();
    let packet_chain_b = validate_packet(&env, &chain_a, &packet_event_chain_b);

    // deliver the message on Chain A and execute lz_receive
    lz_receive(&env, &chain_a, &executor, &packet_chain_b, 0);

    // state assertion
    assert_eq!(chain_a.counter.count(), 1);
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_a.counter.inbound_count(&chain_b.eid), 1);

    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
    assert_eq!(chain_b.counter.outbound_count(&chain_a.eid), 1);
    assert_eq!(chain_b.counter.composed_count(), 1);
}
