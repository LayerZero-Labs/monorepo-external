//! Utility functions for OFT-STD integration tests.

use crate::extensions::oft_fee::FEE_CONFIG_MANAGER_ROLE;
use crate::extensions::pausable::{PAUSER_ROLE, UNPAUSER_ROLE};
use crate::extensions::rate_limiter::{Direction, Mode, RateLimitConfig, RATE_LIMITER_MANAGER_ROLE};
use crate::integration_tests::setup::{decode_packet, ChainSetup};
use crate::oft_types::OftType;
use crate::MintableClient;
use endpoint_v2::{MessagingFee, Origin, OutboundPacket};
use message_lib_common::packet_codec_v1;
use oft_core::{OFTFeeDetail, OFTLimit, OFTReceipt, SendParam};
use soroban_sdk::{
    address_payload::AddressPayload,
    testutils::{Events, Ledger, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};
// ============================================================================
// Address Conversion Utilities
// ============================================================================

pub fn address_to_peer_bytes32(address: &Address) -> BytesN<32> {
    match address.to_payload().unwrap() {
        AddressPayload::ContractIdHash(payload) => payload,
        AddressPayload::AccountIdPublicKeyEd25519(_) => panic!("peer must be a contract"),
    }
}

pub fn peer_bytes32_to_address(env: &Env, bytes32: &BytesN<32>) -> Address {
    AddressPayload::ContractIdHash(bytes32.clone()).to_address(env)
}

#[allow(dead_code)]
pub fn create_recipient_address(env: &Env) -> Address {
    let bytes = BytesN::from_array(env, &[0u8; 32]);
    peer_bytes32_to_address(env, &bytes)
}

// ============================================================================
// OFT Core Operations
// ============================================================================

pub fn quote_oft(
    chain: &ChainSetup<'_>,
    from: &Address,
    send_param: &SendParam,
) -> (OFTLimit, Vec<OFTFeeDetail>, OFTReceipt) {
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

/// Send without fee (standard OFT send).
/// Sender authorizes OFT send (OFT debits by calling token burn directly) and SAC burn.
pub fn send(
    env: &Env,
    chain: &ChainSetup<'_>,
    sender: &Address,
    send_param: &SendParam,
    fee: &MessagingFee,
    refund_address: &Address,
    oft_receipt: &OFTReceipt,
) {
    let token_sub_invoke = match chain.oft.oft_type() {
        OftType::LockUnlock => MockAuthInvoke {
            contract: &chain.oft_token,
            fn_name: "transfer",
            args: (sender, &chain.oft.address, &oft_receipt.amount_received_ld).into_val(env),
            sub_invokes: &[],
        },
        OftType::MintBurn(_) => MockAuthInvoke {
            contract: &chain.oft_token,
            fn_name: "burn",
            args: (sender, &oft_receipt.amount_received_ld).into_val(env),
            sub_invokes: &[],
        },
    };

    env.mock_auths(&[MockAuth {
        address: sender,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "send",
            args: (sender, send_param, fee, refund_address).into_val(env),
            sub_invokes: &[
                token_sub_invoke,
                MockAuthInvoke {
                    contract: &chain.native_token,
                    fn_name: "transfer",
                    args: (sender, &chain.endpoint.address, &fee.native_fee).into_val(env),
                    sub_invokes: &[],
                },
            ],
        },
    }]);
    chain.oft.send(sender, send_param, fee, refund_address);
}

/// Send with fee (OFT fee extension enabled)
/// Order: transfer fee to deposit -> burn tokens -> transfer native fee
pub fn send_with_fee(
    env: &Env,
    chain: &ChainSetup<'_>,
    sender: &Address,
    send_param: &SendParam,
    fee: &MessagingFee,
    refund_address: &Address,
    oft_receipt: &OFTReceipt,
    fee_deposit_address: &Address,
) {
    let fee_amount = oft_receipt.amount_sent_ld - oft_receipt.amount_received_ld;
    let token_sub_invoke = match chain.oft.oft_type() {
        OftType::LockUnlock => MockAuthInvoke {
            contract: &chain.oft_token,
            fn_name: "transfer",
            args: (sender, &chain.oft.address, &oft_receipt.amount_received_ld).into_val(env),
            sub_invokes: &[],
        },
        OftType::MintBurn(_) => MockAuthInvoke {
            contract: &chain.oft_token,
            fn_name: "burn",
            args: (sender, &oft_receipt.amount_received_ld).into_val(env),
            sub_invokes: &[],
        },
    };

    env.mock_auths(&[MockAuth {
        address: sender,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "send",
            args: (sender, send_param, fee, refund_address).into_val(env),
            sub_invokes: &[
                token_sub_invoke,
                MockAuthInvoke {
                    contract: &chain.oft_token,
                    fn_name: "transfer",
                    args: (sender, fee_deposit_address, &fee_amount).into_val(env),
                    sub_invokes: &[],
                },
                MockAuthInvoke {
                    contract: &chain.native_token,
                    fn_name: "transfer",
                    args: (sender, &chain.endpoint.address, &fee.native_fee).into_val(env),
                    sub_invokes: &[],
                },
            ],
        },
    }]);
    chain.oft.send(sender, send_param, fee, refund_address);
}

pub fn try_send(
    env: &Env,
    chain: &ChainSetup<'_>,
    sender: &Address,
    send_param: &SendParam,
    fee: &MessagingFee,
    refund_address: &Address,
    oft_receipt: &OFTReceipt,
) -> bool {
    let token_sub_invoke = match chain.oft.oft_type() {
        OftType::LockUnlock => MockAuthInvoke {
            contract: &chain.oft_token,
            fn_name: "transfer",
            args: (sender, &chain.oft.address, &oft_receipt.amount_received_ld).into_val(env),
            sub_invokes: &[],
        },
        OftType::MintBurn(_) => MockAuthInvoke {
            contract: &chain.oft_token,
            fn_name: "burn",
            args: (sender, &oft_receipt.amount_received_ld).into_val(env),
            sub_invokes: &[],
        },
    };

    env.mock_auths(&[MockAuth {
        address: sender,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "send",
            args: (sender, send_param, fee, refund_address).into_val(env),
            sub_invokes: &[
                token_sub_invoke,
                MockAuthInvoke {
                    contract: &chain.native_token,
                    fn_name: "transfer",
                    args: (sender, &chain.endpoint.address, &fee.native_fee).into_val(env),
                    sub_invokes: &[],
                },
            ],
        },
    }]);
    chain.oft.try_send(sender, send_param, fee, refund_address).is_ok()
}

// ============================================================================
// Packet Handling
// ============================================================================

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

pub fn try_lz_receive(
    env: &Env,
    chain: &ChainSetup<'_>,
    executor: &Address,
    packet: &OutboundPacket,
    recipient: &Address,
    value: i128,
) -> bool {
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
    endpoint_v2::LayerZeroReceiverClient::new(env, &chain.oft.address)
        .try_lz_receive(executor, &origin, &packet.guid, &packet.message, &extra_options, &value)
        .is_ok()
}

// returns (encoded_payload, options, send_library)
pub fn scan_packet_sent_event(env: &Env, endpoint: &Address) -> Option<(Bytes, Bytes, Address)> {
    use soroban_sdk::TryFromVal;

    let mut packet = None;
    let events = env.events().all().filter_by_contract(endpoint);
    for event in events.events().iter() {
        let soroban_sdk::xdr::ContractEventBody::V0(v0) = &event.body;

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

// ============================================================================
// Token Operations
// ============================================================================

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

/// Mints the OFT token (via the Mintable wrapper) to the given address.
/// Use when OFT is MintBurn; the wrapper calls the underlying SAC mint.
pub fn mint_oft_token_to(env: &Env, chain: &ChainSetup<'_>, to: &Address, amount: i128) {
    match chain.oft.oft_type() {
        OftType::LockUnlock => {
            env.mock_auths(&[MockAuth {
                address: &chain.owner,
                invoke: &MockAuthInvoke {
                    contract: &chain.oft_token,
                    fn_name: "mint",
                    args: (to, &amount).into_val(env),
                    sub_invokes: &[],
                },
            }]);
            StellarAssetClient::new(env, &chain.oft_token).mint(to, &amount);
        }
        OftType::MintBurn(_) => {
            env.mock_auths(&[MockAuth {
                address: &chain.owner,
                invoke: &MockAuthInvoke {
                    contract: &chain.sac_wrapper,
                    fn_name: "mint",
                    args: (to, &amount, &chain.owner).into_val(env),
                    sub_invokes: &[MockAuthInvoke {
                        contract: &chain.oft_token,
                        fn_name: "mint",
                        args: (to, &amount).into_val(env),
                        sub_invokes: &[],
                    }],
                },
            }]);
            MintableClient::new(env, &chain.sac_wrapper).mint(to, &amount, &chain.owner);
        }
    }
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

pub fn token_balance(env: &Env, token: &Address, account: &Address) -> i128 {
    soroban_sdk::token::TokenClient::new(env, token).balance(account)
}

// ============================================================================
// Pausable Extension Operations
// ============================================================================

pub fn set_paused(env: &Env, chain: &ChainSetup<'_>, paused: bool) {
    // `pause` / `unpause` are protected by RBAC (`PAUSER_ROLE` / `UNPAUSER_ROLE`). Grant them to owner for tests.
    let pauser = Symbol::new(env, PAUSER_ROLE);
    let unpauser = Symbol::new(env, UNPAUSER_ROLE);
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "grant_role",
            args: (&chain.owner, &pauser, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.grant_role(&chain.owner, &pauser, &chain.owner);
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "grant_role",
            args: (&chain.owner, &unpauser, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.grant_role(&chain.owner, &unpauser, &chain.owner);

    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: if paused { "pause" } else { "unpause" },
            args: (&chain.owner,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    if paused {
        chain.oft.pause(&chain.owner);
    } else {
        chain.oft.unpause(&chain.owner);
    }
}

pub fn is_paused(chain: &ChainSetup<'_>) -> bool {
    chain.oft.is_paused()
}

// ============================================================================
// OFT Fee Extension Operations
// ============================================================================

pub fn set_fee_deposit_address(env: &Env, chain: &ChainSetup<'_>, deposit_address: &Address) {
    let deposit_address_opt = Some(deposit_address.clone());
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "set_fee_deposit_address",
            args: (&deposit_address_opt, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.set_fee_deposit_address(&deposit_address_opt, &chain.owner);
}

pub fn set_default_fee_bps(env: &Env, chain: &ChainSetup<'_>, fee_bps: u32) {
    // `set_default_fee_bps` is protected by RBAC (`FEE_CONFIG_MANAGER_ROLE`). Grant it to owner for tests.
    let role = Symbol::new(env, FEE_CONFIG_MANAGER_ROLE);
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "grant_role",
            args: (&chain.owner, &role, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.grant_role(&chain.owner, &role, &chain.owner);

    let fee_bps_opt = Some(fee_bps);
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "set_default_fee_bps",
            args: (&fee_bps_opt, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.set_default_fee_bps(&fee_bps_opt, &chain.owner);
}

pub fn set_fee_bps(env: &Env, chain: &ChainSetup<'_>, dst_eid: u32, fee_bps: u32) {
    // `set_fee_bps` is protected by RBAC (`FEE_CONFIG_MANAGER_ROLE`). Grant it to owner for tests.
    let role = Symbol::new(env, FEE_CONFIG_MANAGER_ROLE);
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "grant_role",
            args: (&chain.owner, &role, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.grant_role(&chain.owner, &role, &chain.owner);

    let fee_bps_opt = Some(fee_bps);
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "set_fee_bps",
            args: (&dst_eid, &fee_bps_opt, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.set_fee_bps(&dst_eid, &fee_bps_opt, &chain.owner);
}

// ============================================================================
// Rate Limiter Extension Operations
// ============================================================================

pub fn set_rate_limit(
    env: &Env,
    chain: &ChainSetup<'_>,
    direction: &Direction,
    dst_eid: u32,
    limit: i128,
    window_seconds: u64,
) {
    set_rate_limit_with_mode(env, chain, direction, dst_eid, limit, window_seconds, Mode::Net);
}

pub fn set_rate_limit_with_mode(
    env: &Env,
    chain: &ChainSetup<'_>,
    direction: &Direction,
    dst_eid: u32,
    limit: i128,
    window_seconds: u64,
    mode: Mode,
) {
    // `set_rate_limit` is protected by RBAC (`RATE_LIMITER_MANAGER_ROLE`). Grant it to owner for tests.
    let role = Symbol::new(env, RATE_LIMITER_MANAGER_ROLE);
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "grant_role",
            args: (&chain.owner, &role, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.grant_role(&chain.owner, &role, &chain.owner);

    let config = Some(RateLimitConfig { limit, window_seconds, mode });
    env.mock_auths(&[MockAuth {
        address: &chain.owner,
        invoke: &MockAuthInvoke {
            contract: &chain.oft.address,
            fn_name: "set_rate_limit",
            args: (direction, &dst_eid, &config, &chain.owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    chain.oft.set_rate_limit(direction, &dst_eid, &config, &chain.owner);
}

pub fn rate_limit_capacity(chain: &ChainSetup<'_>, direction: &Direction, eid: u32) -> i128 {
    chain.oft.rate_limit_capacity(direction, &eid)
}

pub fn rate_limit_in_flight(chain: &ChainSetup<'_>, direction: &Direction, eid: u32) -> i128 {
    chain.oft.rate_limit_in_flight(direction, &eid)
}

// ============================================================================
// Time Utilities
// ============================================================================

pub fn advance_time(env: &Env, seconds: u64) {
    let current = env.ledger().timestamp();
    env.ledger().set_timestamp(current + seconds);
}

#[allow(dead_code)]
pub fn set_timestamp(env: &Env, timestamp: u64) {
    env.ledger().set_timestamp(timestamp);
}

// ============================================================================
// SendParam Builder
// ============================================================================

pub fn create_send_param(env: &Env, dst_eid: u32, amount_ld: i128, min_amount_ld: i128, to: &BytesN<32>) -> SendParam {
    SendParam {
        dst_eid,
        to: to.clone(),
        amount_ld,
        min_amount_ld,
        extra_options: Bytes::new(env),
        compose_msg: Bytes::new(env),
        oft_cmd: Bytes::new(env),
    }
}
