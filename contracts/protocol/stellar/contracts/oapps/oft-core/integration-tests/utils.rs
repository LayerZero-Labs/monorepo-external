use core::ops::Mul;

use crate::{
    codec::{oft_compose_msg_codec::OFTComposeMsg, oft_msg_codec},
    integration_tests::setup::{decode_packet, ChainSetup},
    types::{OFTFeeDetail, OFTLimit, OFTReceipt, SendParam},
};
use endpoint_v2::{MessagingFee, Origin, OutboundPacket};
use message_lib_common::packet_codec_v1;
use soroban_sdk::{
    address_payload::AddressPayload,
    testutils::{Events, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};

pub fn address_to_peer_bytes32(address: &Address) -> BytesN<32> {
    match address.to_payload().unwrap() {
        AddressPayload::ContractIdHash(payload) => payload,
        AddressPayload::AccountIdPublicKeyEd25519(_) => panic!("peer must be a contract"),
    }
}

pub fn peer_bytes32_to_address(env: &Env, bytes32: &BytesN<32>) -> Address {
    AddressPayload::ContractIdHash(bytes32.clone()).to_address(env)
}

pub fn quote_oft(chain: &ChainSetup<'_>, from: &Address, send_param: &SendParam) -> (OFTLimit, Vec<OFTFeeDetail>, OFTReceipt) {
    chain.oft.quote_oft(from, send_param)
}

pub fn quote_send(
    env: &Env,
    chain: &ChainSetup<'_>,
    sender: &Address,
    send_param: &SendParam,
    pay_in_zro: bool,
) -> MessagingFee {
    env.mock_auths(&[MockAuth {
        address: sender,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "quote_send",
            args: (sender, send_param, &pay_in_zro).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.quote_send(sender, send_param, &pay_in_zro)
}

pub fn send(
    env: &Env,
    chain: &ChainSetup<'_>,
    sender: &Address,
    send_param: &SendParam,
    fee: &MessagingFee,
    refund_address: &Address,
    oft_receipt: &OFTReceipt,
) {
    env.mock_auths(&[MockAuth {
        address: sender,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "send",
            args: (sender, send_param, fee, refund_address).into_val(env),
            sub_invokes: &[
                MockAuthInvoke {
                    contract: &chain.native_token,
                    fn_name: "transfer",
                    args: (sender, &chain.endpoint.address, &fee.native_fee).into_val(env),
                    sub_invokes: &[],
                },
                MockAuthInvoke {
                    contract: &chain.oft_token,
                    fn_name: "burn",
                    args: (sender, &oft_receipt.amount_received_ld).into_val(env),
                    sub_invokes: &[],
                },
            ],
        },
    }]);
    chain.oft.send(sender, send_param, fee, refund_address);
}

pub fn validate_packet(env: &Env, chain: &ChainSetup<'_>, packet_event: &(Bytes, Bytes, Address)) {
    let packet = decode_packet(env, &packet_event.0);
    let encoded_header = packet_codec_v1::encode_packet_header(env, &packet);
    let payload_hash = packet_codec_v1::payload_hash(env, &packet);

    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.sml.address,
            fn_name: "validate_packet",
            args: (&encoded_header, &payload_hash).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.sml.validate_packet(&encoded_header, &payload_hash);
}

pub fn lz_receive(
    env: &Env,
    chain: &ChainSetup<'_>,
    executor: &Address,
    packet: &OutboundPacket,
    recipient: &Address,
    value: i128,
) {
    let origin =
        Origin { src_eid: packet.src_eid, sender: address_to_peer_bytes32(&packet.sender), nonce: packet.nonce };
    let extra_options = recipient.to_xdr(env);

    env.mock_auths(&[MockAuth {
        address: executor,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "lz_receive",
            args: (executor, &origin, &packet.guid, &packet.message, &extra_options, &value).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint_v2::LayerZeroReceiverClient::new(env, &chain.oft.address).lz_receive(
        executor,
        &origin,
        &packet.guid,
        &packet.message,
        &extra_options,
        &value,
    );
}

pub fn lz_compose(
    env: &Env,
    chain: &ChainSetup<'_>,
    executor: &Address,
    packet: &OutboundPacket,
    index: u32,
    extra_data: &Bytes,
    value: i128,
) {
    let oft_msg = oft_msg_codec::OFTMessage::decode(&packet.message);
    let compose = oft_msg.compose.unwrap();
    let oft_compose_msg = OFTComposeMsg {
        nonce: packet.nonce,
        src_eid: packet.src_eid,
        amount_ld: (oft_msg.amount_sd as i128).mul(chain.oft.decimal_conversion_rate()),
        compose_from: compose.from,
        compose_msg: compose.msg,
    }
    .encode(&env);

    chain.composer.lz_compose(executor, &chain.oft.address, &packet.guid, &index, &oft_compose_msg, extra_data, &value);
}

// returns (encoded_payload, options, send_library)
pub fn scan_packet_sent_event(env: &Env, endpoint: &Address) -> Option<(Bytes, Bytes, Address)> {
    use soroban_sdk::TryFromVal;

    let mut packet = None;
    let events = env.events().all().filter_by_contract(endpoint);
    for event in events.events().iter() {
        let v0 = match &event.body {
            soroban_sdk::xdr::ContractEventBody::V0(v0) => v0,
        };

        // Check if this is a packet_sent event by looking at topics
        let mut is_packet_sent = false;
        for topic in v0.topics.iter() {
            if let Ok(sym) = Symbol::try_from_val(env, topic) {
                if sym == Symbol::new(env, "packet_sent") {
                    is_packet_sent = true;
                    break;
                }
            }
        }

        if is_packet_sent {
            let data: Val = Val::try_from_val(env, &v0.data).unwrap();
            let map: Map<Symbol, Val> = data.into_val(env);

            let encoded_payload: Bytes = map.get(Symbol::new(env, "encoded_packet")).unwrap().into_val(env);
            let options: Bytes = map.get(Symbol::new(env, "options")).unwrap().into_val(env);
            let send_library: Address = map.get(Symbol::new(env, "send_library")).unwrap().into_val(env);

            packet = Some((encoded_payload, options, send_library));
        }
    }

    packet
}

pub fn mint_to(env: &Env, owner: &Address, token: &Address, to: &Address, amount: i128) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: token,
            fn_name: "mint",
            args: (to, amount).into_val(env),
            sub_invokes: &[],
        },
    }]);

    let sac = StellarAssetClient::new(env, token);
    sac.mint(to, &amount);
}

pub fn transfer_sac_admin(env: &Env, owner: &Address, token: &Address, new_admin: &Address) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: token,
            fn_name: "set_admin",
            args: (new_admin,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    StellarAssetClient::new(env, token).set_admin(new_admin);
}
