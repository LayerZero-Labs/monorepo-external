//! Integration test setup for OFT.
//!
//! This file contains TestOFT contract and test setup utilities.

extern crate std;

use crate::{
    self as oft_core,
    integration_tests::utils::{address_to_peer_bytes32, peer_bytes32_to_address},
    oft_core::{OFTClient, OFTCore, OFTInternal},
    storage::OFTStorage,
};
use common_macros::contract_impl;
use endpoint_v2::{EndpointV2, EndpointV2Client, ILayerZeroComposer, Origin};
use oapp::oapp_receiver::LzReceiveInternal;
use simple_message_lib::{SimpleMessageLib, SimpleMessageLibClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, log, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env, IntoVal,
};

// ============================================================================
// Test OFT Contract
// ============================================================================

#[oapp_macros::oapp]
#[common_macros::lz_contract]
pub struct TestOFT;

impl LzReceiveInternal for TestOFT {
    fn __lz_receive(
        env: &Env,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        executor: &Address,
        value: i128,
    ) {
        <Self as OFTInternal>::__receive(env, origin, guid, message, extra_data, executor, value)
    }
}

#[contract_impl]
impl TestOFT {
    pub fn __constructor(
        env: &Env,
        token: &Address,
        owner: &Address,
        endpoint: &Address,
        delegate: &Address,
        shared_decimals: u32,
    ) {
        Self::__initialize_oft(env, token, shared_decimals, owner, endpoint, delegate)
    }
}

#[contractimpl(contracttrait)]
impl OFTCore for TestOFT {}

impl OFTInternal for TestOFT {
    fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128) {
        // Get the amounts (handles decimal conversion, fees, etc.)
        let (amount_sent_ld, amount_received_ld) = Self::__debit_view(env, amount_ld, min_amount_ld, dst_eid);
        // Actually burn tokens from sender
        StellarAssetClient::new(env, &OFTStorage::token(env).unwrap()).burn(sender, &amount_sent_ld);
        (amount_sent_ld, amount_received_ld)
    }

    fn __credit(env: &Env, to: &Address, amount_ld: i128, _src_eid: u32) -> i128 {
        // Actually mint tokens to recipient
        StellarAssetClient::new(env, &OFTStorage::token(env).unwrap()).mint(to, &amount_ld);
        amount_ld
    }
}

// ============================================================================
// Dummy Composer for testing compose messages
// ============================================================================

#[contracttype]
pub struct ComposeMessage {
    pub executor: Address,
    pub from: Address,
    pub guid: BytesN<32>,
    pub index: u32,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub value: i128,
}

#[contract]
pub struct DummyComposer;

#[contract_impl]
impl DummyComposer {
    pub fn __constructor(env: &Env, endpoint: &Address) {
        env.storage().instance().set(&symbol_short!("endpoint"), endpoint);
    }

    pub fn compose_message(env: &Env) -> Option<ComposeMessage> {
        env.storage().instance().get(&symbol_short!("msg"))
    }
}

#[contract_impl]
impl ILayerZeroComposer for DummyComposer {
    fn lz_compose(
        env: &Env,
        executor: &Address,
        from: &Address,
        guid: &BytesN<32>,
        index: u32,
        message: &Bytes,
        extra_data: &Bytes,
        value: i128,
    ) {
        let endpoint_address: Address = env.storage().instance().get(&symbol_short!("endpoint")).unwrap();
        let endpoint = endpoint_v2::MessagingComposerClient::new(env, &endpoint_address);
        endpoint.clear_compose(&env.current_contract_address(), from, guid, &index, message);

        env.storage().instance().set(
            &symbol_short!("msg"),
            &ComposeMessage {
                executor: executor.clone(),
                from: from.clone(),
                guid: guid.clone(),
                index,
                message: message.clone(),
                extra_data: extra_data.clone(),
                value,
            },
        );
    }
}

// ============================================================================
// Test Setup
// ============================================================================

pub struct ChainSetup<'a> {
    pub eid: u32,
    pub owner: Address,
    pub native_token: Address,
    pub oft_token: Address,
    pub endpoint: EndpointV2Client<'a>,
    pub sml: SimpleMessageLibClient<'a>,
    pub oft: OFTClient<'a>,
    pub composer: DummyComposerClient<'a>,
}

pub struct TestSetup<'a> {
    pub env: Env,

    pub chain_a: ChainSetup<'a>,
    pub chain_b: ChainSetup<'a>,
}

fn setup_chain<'a>(env: &Env) -> ChainSetup<'a> {
    let owner = Address::generate(env);

    let sac = env.register_stellar_asset_contract_v2(owner.clone());
    let native_token = sac.address();

    // Create ZRO token
    let zro_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let zro_token = zro_sac.address();

    // Create OFT token
    let oft_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let oft_token = oft_sac.address();

    let eid: u32 = 30400; // Test EID
    let endpoint_address = env.register(EndpointV2, (&owner, eid, &native_token));
    let fee_recipient = Address::generate(env);
    let sml_address = env.register(SimpleMessageLib, (&owner, &endpoint_address, &fee_recipient));
    let delegate = owner.clone();
    let shared_decimals: u32 = 6; // Default shared decimals
    let oft_address = env.register(TestOFT, (&oft_token, &owner, &endpoint_address, &delegate, &shared_decimals));

    let composer_address = env.register(DummyComposer, (&endpoint_address,));

    let endpoint = EndpointV2Client::new(env, &endpoint_address);
    let sml = SimpleMessageLibClient::new(env, &sml_address);
    let oft = OFTClient::new(env, &oft_address);
    let composer = DummyComposerClient::new(env, &composer_address);

    // Set ZRO token in endpoint
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint_address,
            fn_name: "set_zro",
            args: (&zro_token,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint.set_zro(&zro_token);

    register_library(env, &owner, &endpoint, &sml.address);
    ChainSetup { eid, owner, native_token, oft_token, endpoint, sml, oft, composer }
}

pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let chain_a = setup_chain(&env);
    let chain_b = setup_chain(&env);

    let chain_a_oft_token_decimals = TokenClient::new(&env, &chain_a.oft_token).decimals();
    let chain_b_oft_token_decimals = TokenClient::new(&env, &chain_b.oft_token).decimals();

    log!(&env, "endpoint_a: {:?}", chain_a.endpoint.address);
    log!(&env, "native_token_a: {:?}", chain_a.native_token);
    log!(&env, "oft_token_a: {:?}", chain_a.oft.token());
    log!(&env, "oft_token_a decimals: {:?}", chain_a_oft_token_decimals);
    log!(&env, "oft_a: {:?}", chain_a.oft.address);
    log!(&env, "sml_a: {:?}", chain_a.sml.address);

    log!(&env, "endpoint_b: {:?}", chain_b.endpoint.address);
    log!(&env, "native_token_b: {:?}", chain_b.native_token);
    log!(&env, "oft_token_b: {:?}", chain_b.oft.token());
    log!(&env, "oft_token_b decimals: {:?}", chain_b_oft_token_decimals);
    log!(&env, "oft_b: {:?}", chain_b.oft.address);
    log!(&env, "sml_b: {:?}", chain_b.sml.address);

    TestSetup { env, chain_a, chain_b }
}

pub fn wire_endpoint(env: &Env, chains: &[&ChainSetup<'_>]) {
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }
            set_default_send_library(env, &chain.owner, &chain.endpoint, other_chain.eid, &chain.sml.address);
            set_default_receive_library(env, &chain.owner, &chain.endpoint, other_chain.eid, &chain.sml.address);
        }
    }
}

pub fn wire_oft(env: &Env, chains: &[&ChainSetup<'_>]) {
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }
            set_peer(
                env,
                &chain.owner,
                &chain.oft,
                other_chain.eid,
                &address_to_peer_bytes32(&other_chain.oft.address),
            );
        }
    }
}

pub fn set_peer(env: &Env, owner: &Address, oft: &OFTClient<'_>, dst_eid: u32, peer: &BytesN<32>) {

    let peer_option = Some(peer.clone());
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &oft.address,
            fn_name: "set_peer",
            args: (&dst_eid, &peer_option, owner).into_val(env),
            sub_invokes: &[],
        },
    }]);
    oapp::oapp_core::OAppCoreClient::new(env, &oft.address).set_peer(&dst_eid, &peer_option, owner);
}

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

pub fn set_default_send_library(
    env: &Env,
    owner: &Address,
    endpoint: &EndpointV2Client<'_>,
    dst_eid: u32,
    lib: &Address,
) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint.address,
            fn_name: "set_default_send_library",
            args: (&dst_eid, lib).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint.set_default_send_library(&dst_eid, lib);
}

pub fn set_default_receive_library(
    env: &Env,
    owner: &Address,
    endpoint: &EndpointV2Client<'_>,
    src_eid: u32,
    lib: &Address,
) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint.address,
            fn_name: "set_default_receive_library",
            args: (&src_eid, lib, &0u64).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint.set_default_receive_library(&src_eid, lib, &0u64);
}

pub fn decode_packet(env: &Env, encoded_packet: &soroban_sdk::Bytes) -> endpoint_v2::OutboundPacket {
    use message_lib_common::packet_codec_v1::*;
    use utils::buffer_reader::BufferReader;

    let header = decode_packet_header(env, &encoded_packet.slice(0..HEADER_LENGTH));
    let payload = encoded_packet.slice(HEADER_LENGTH..);

    let mut payload_reader = BufferReader::new(&payload);
    let guid = payload_reader.read_bytes_n::<32>();
    let message = payload_reader.read_bytes_until_end();

    endpoint_v2::OutboundPacket {
        nonce: header.nonce,
        src_eid: header.src_eid,
        sender: peer_bytes32_to_address(env, &header.sender),
        dst_eid: header.dst_eid,
        receiver: header.receiver,
        guid,
        message,
    }
}
