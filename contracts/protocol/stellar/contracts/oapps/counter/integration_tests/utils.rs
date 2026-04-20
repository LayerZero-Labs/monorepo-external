//! Common utilities shared between SML and ULN302 integration tests.

extern crate std;

use crate::{codec::MsgType, counter::CounterClient, tests::mint_to};
use endpoint_v2::{EndpointV2Client, MessagingFee, Origin, OutboundPacket};
use message_lib_common::packet_codec_v1;
use soroban_sdk::{
    address_payload::AddressPayload,
    testutils::{Events, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};
use utils::buffer_reader::BufferReader;
use utils::testing_utils::decode_event_topics_data;

/// Trait for common fields in chain setup structs.
/// Both SML and ULN302 ChainSetup implement this trait.
pub trait ChainSetupCommon<'a> {
    fn counter(&self) -> &CounterClient<'a>;
    fn endpoint(&self) -> &EndpointV2Client<'a>;
    fn native_token(&self) -> &Address;
    fn owner(&self) -> &Address;
    /// Validates a packet using the message library's verification mechanism.
    /// SML calls validate_packet, ULN302 does DVN verify + commit.
    fn validate_packet(&self, env: &Env, packet_event: &(Bytes, Bytes, Address)) -> OutboundPacket;
}

/// Converts an Address into its 32-byte payload.
pub fn address_to_bytes32(address: &Address) -> BytesN<32> {
    match address.to_payload().unwrap() {
        AddressPayload::AccountIdPublicKeyEd25519(payload) => payload,
        AddressPayload::ContractIdHash(payload) => payload,
    }
}

/// Sets the ZRO token on the endpoint with owner authorization.
pub fn set_zro(env: &Env, owner: &Address, endpoint: &EndpointV2Client<'_>, zro_token: &Address) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint.address,
            fn_name: "set_zro",
            args: (zro_token,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint.set_zro(zro_token);
}

/// Registers a message library on the endpoint with owner authorization.
pub fn register_library(env: &Env, owner: &Address, endpoint: &EndpointV2Client<'_>, lib: &Address) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint.address,
            fn_name: "register_library",
            args: (lib,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint.register_library(lib);
}

/// Sets the peer address for a counter on a destination EID.
pub fn set_peer(env: &Env, owner: &Address, counter: &CounterClient<'_>, dst_eid: u32, peer: &BytesN<32>) {
    let peer_option = Some(peer.clone());
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &counter.address,
            fn_name: "set_peer",
            args: (&dst_eid, &peer_option, owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    counter.set_peer(&dst_eid, &peer_option, owner);
}

/// Decodes an outbound packet emitted by the endpoint.
pub fn decode_packet(env: &Env, encoded_packet: &Bytes) -> OutboundPacket {
    let header = packet_codec_v1::decode_packet_header(env, &encoded_packet.slice(0..packet_codec_v1::HEADER_LENGTH));
    let payload = encoded_packet.slice(packet_codec_v1::HEADER_LENGTH..);

    let mut payload_reader = BufferReader::new(&payload);
    let guid = payload_reader.read_bytes_n::<32>();
    let message = payload_reader.read_bytes_until_end();

    OutboundPacket {
        nonce: header.nonce,
        src_eid: header.src_eid,
        sender: Address::from_payload(env, AddressPayload::ContractIdHash(header.sender)),
        dst_eid: header.dst_eid,
        receiver: header.receiver,
        guid,
        message,
    }
}

pub fn quote<'a, C: ChainSetupCommon<'a>>(chain: &C, dst_eid: u32, msg_type: MsgType, options: &Bytes) -> MessagingFee {
    chain.counter().quote(&dst_eid, &(msg_type as u32), options, &false)
}

pub fn increment<'a, C: ChainSetupCommon<'a>>(
    env: &Env,
    chain: &C,
    sender: &Address,
    dst_eid: u32,
    msg_type: MsgType,
    options: &Bytes,
    fee: &MessagingFee,
) {
    let msg_type = msg_type as u32;
    env.mock_auths(&[MockAuth {
        address: sender,
        invoke: &MockAuthInvoke {
            contract: &chain.counter().address,
            fn_name: "increment",
            args: (sender, &dst_eid, &msg_type, options, fee).into_val(env),
            sub_invokes: &[MockAuthInvoke {
                contract: chain.native_token(),
                fn_name: "transfer",
                args: (sender, &chain.endpoint().address, &fee.native_fee).into_val(env),
                sub_invokes: &[],
            }],
        },
    }]);
    chain.counter().increment(sender, &dst_eid, &msg_type, options, fee);
}

/// Execute lz_receive on the counter contract.
/// Automatically mints native tokens to the executor if value > 0.
pub fn lz_receive<'a, C: ChainSetupCommon<'a>>(
    env: &Env,
    chain: &C,
    executor: &Address,
    packet: &OutboundPacket,
    value: i128,
) {
    // Mint native tokens to executor if value > 0
    if value > 0 {
        mint_to(env, chain.owner(), chain.native_token(), executor, value);
    }

    let origin = Origin { src_eid: packet.src_eid, sender: address_to_bytes32(&packet.sender), nonce: packet.nonce };

    let sub_invokes_with_transfer = [MockAuthInvoke {
        contract: chain.native_token(),
        fn_name: "transfer",
        args: (executor, &chain.counter().address, &value).into_val(env),
        sub_invokes: &[],
    }];

    env.mock_auths(&[MockAuth {
        address: executor,
        invoke: &MockAuthInvoke {
            contract: &chain.counter().address,
            fn_name: "lz_receive",
            args: (executor, &origin, &packet.guid, &packet.message, &Bytes::new(env), &value).into_val(env),
            sub_invokes: if value > 0 { &sub_invokes_with_transfer } else { &[] },
        },
    }]);
    chain.counter().lz_receive(executor, &origin, &packet.guid, &packet.message, &Bytes::new(env), &value);
}

/// Execute lz_compose on the counter contract.
/// Automatically mints native tokens to the executor if value > 0.
pub fn lz_compose<'a, C: ChainSetupCommon<'a>>(
    env: &Env,
    chain: &C,
    executor: &Address,
    packet: &OutboundPacket,
    value: i128,
) {
    // Mint native tokens to executor if value > 0
    if value > 0 {
        mint_to(env, chain.owner(), chain.native_token(), executor, value);
    }

    let sub_invokes_with_transfer = [MockAuthInvoke {
        contract: chain.native_token(),
        fn_name: "transfer",
        args: (executor, &chain.counter().address, &value).into_val(env),
        sub_invokes: &[],
    }];

    env.mock_auths(&[MockAuth {
        address: executor,
        invoke: &MockAuthInvoke {
            contract: &chain.counter().address,
            fn_name: "lz_compose",
            args: (executor, &chain.counter().address, &packet.guid, &0_u32, &packet.message, &Bytes::new(env), &value)
                .into_val(env),
            sub_invokes: if value > 0 { &sub_invokes_with_transfer } else { &[] },
        },
    }]);
    chain.counter().lz_compose(
        executor,
        &chain.counter().address,
        &packet.guid,
        &0,
        &packet.message,
        &Bytes::new(env),
        &value,
    );
}

/// Validates a packet using the chain's message library verification mechanism.
/// This is a convenience wrapper around the trait method.
pub fn validate_packet<'a, C: ChainSetupCommon<'a>>(
    env: &Env,
    chain: &C,
    packet_event: &(Bytes, Bytes, Address),
) -> OutboundPacket {
    chain.validate_packet(env, packet_event)
}

/// Scans for the latest packet_sent event and returns (encoded_payload, options, send_library).
pub fn scan_packet_sent_event(env: &Env, endpoint: &Address) -> Option<(Bytes, Bytes, Address)> {
    let events = env.events().all().filter_by_contract(endpoint);
    let packet_sent_symbol = Symbol::new(env, "packet_sent").to_val();

    // Iterate in reverse to find the most recent packet sent event
    for event in events.events().iter().rev() {
        let Some((topics, data)) = decode_event_topics_data(env, event) else {
            continue;
        };
        if topics.contains(packet_sent_symbol) {
            let map: Map<Symbol, Val> = data.into_val(env);

            let encoded_payload: Bytes = map.get(Symbol::new(env, "encoded_packet")).unwrap().into_val(env);
            let options: Bytes = map.get(Symbol::new(env, "options")).unwrap().into_val(env);
            let send_library: Address = map.get(Symbol::new(env, "send_library")).unwrap().into_val(env);

            return Some((encoded_payload, options, send_library));
        }
    }

    None
}

/// Scans for ALL packet_sent events from an endpoint and returns them in chronological order.
/// NOTE: In Soroban test environment, events from previous contract calls may be cleared.
/// Use this only after all messages have been sent in a single "transaction" or collect events incrementally.
#[allow(dead_code)]
pub fn scan_all_packet_sent_events(env: &Env, endpoint: &Address) -> Vec<(Bytes, Bytes, Address)> {
    let events = env.events().all().filter_by_contract(endpoint);
    let packet_sent_symbol = Symbol::new(env, "packet_sent").to_val();
    let mut result = Vec::new(env);

    for event in events.events().iter() {
        let Some((topics, data)) = decode_event_topics_data(env, event) else {
            continue;
        };
        if topics.contains(packet_sent_symbol) {
            let map: Map<Symbol, Val> = data.into_val(env);

            let encoded_payload: Bytes = map.get(Symbol::new(env, "encoded_packet")).unwrap().into_val(env);
            let options: Bytes = map.get(Symbol::new(env, "options")).unwrap().into_val(env);
            let send_library: Address = map.get(Symbol::new(env, "send_library")).unwrap().into_val(env);

            result.push_back((encoded_payload, options, send_library));
        }
    }

    result
}

/// Compose sent event data: (from, to, guid, index, message)
pub type ComposeSentEvent = (Address, Address, BytesN<32>, u32, Bytes);

/// Scans for the latest compose_sent event and returns (from, to, guid, index, message).
pub fn scan_compose_sent_event(env: &Env, endpoint: &Address) -> Option<ComposeSentEvent> {
    let events = env.events().all().filter_by_contract(endpoint);
    let compose_sent_symbol = Symbol::new(env, "compose_sent").to_val();

    // Iterate in reverse to find the most recent compose sent event
    for event in events.events().iter().rev() {
        let Some((topics, data)) = decode_event_topics_data(env, event) else {
            continue;
        };
        if topics.contains(compose_sent_symbol) {
            let map: Map<Symbol, Val> = data.into_val(env);
            let from: Address = topics.get(1).unwrap().into_val(env);
            let to: Address = topics.get(2).unwrap().into_val(env);
            let guid: BytesN<32> = topics.get(3).unwrap().into_val(env);
            let index: u32 = topics.get(4).unwrap().into_val(env);
            let message: Bytes = map.get(Symbol::new(env, "message")).unwrap().into_val(env);

            return Some((from, to, guid, index, message));
        }
    }

    None
}
