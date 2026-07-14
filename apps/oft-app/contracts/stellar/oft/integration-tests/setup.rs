//! Integration test setup for OFT-STD with real EndpointV2 and SimpleMessageLib.
//!
//! This file contains test setup utilities for OFT-STD with all extensions enabled.

extern crate std;

use crate::{
    integration_tests::utils::{address_to_peer_bytes32, peer_bytes32_to_address},
    oft::{OFTClient, OFT},
    oft_types::OftType,
};
use endpoint_v2::{EndpointV2, EndpointV2Client};
use simple_message_lib::{SimpleMessageLib, SimpleMessageLibClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, log,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, IntoVal,
};

// ============================================================================
// Mock SAC Wrapper - implements Mintable for integration tests
// ============================================================================
// Wraps a Stellar Asset Contract (SAC). The wrapper is set as SAC admin and
// implements mint(env, to, amount, operation) so the OFT uses it for credit (mint).
// OFT burns on the token directly; this mock still has burn for completeness.

#[contracttype]
pub enum MockSacWrapperKey {
    Sac,
}

#[contract]
pub struct MockSacWrapper;

#[contractimpl]
impl MockSacWrapper {
    pub fn __constructor(env: &Env, sac: Address) {
        env.storage().instance().set(&MockSacWrapperKey::Sac, &sac);
    }

    /// Mintable::mint - mints on the underlying SAC (wrapper must be SAC admin).
    pub fn mint(env: &Env, to: &Address, amount: i128, _operation: &Address) {
        let sac: Address = env.storage().instance().get(&MockSacWrapperKey::Sac).unwrap();
        StellarAssetClient::new(env, &sac).mint(to, &amount);
    }
}

// ============================================================================
// Dummy Recipient - used to create valid contract addresses for recipients
// ============================================================================

#[contract]
pub struct DummyRecipient;

#[contractimpl]
impl DummyRecipient {
    pub fn __constructor(_env: &Env) {}
}

/// Creates a valid recipient address by deploying a dummy contract.
/// Use this in tests when the address needs to pass the `.exists()` check.
pub fn create_recipient_address(env: &Env) -> Address {
    env.register(DummyRecipient, ())
}

// ============================================================================
// Test Setup
// ============================================================================

pub struct ChainSetup<'a> {
    pub eid: u32,
    pub owner: Address,
    pub native_token: Address,
    pub zro_token: Address,
    /// Underlying SAC for the OFT token (used for balance, transfer, mint_to).
    pub oft_token: Address,
    /// Mock SAC wrapper implementing Mintable; OFT uses it for mint on credit.
    pub sac_wrapper: Address,
    pub endpoint: EndpointV2Client<'a>,
    pub sml: SimpleMessageLibClient<'a>,
    pub oft: OFTClient<'a>,
    pub fee_collector: Address,
}

pub struct TestSetup<'a> {
    pub env: Env,
    pub chain_a: ChainSetup<'a>,
    pub chain_b: ChainSetup<'a>,
}

fn setup_chain<'a>(env: &Env, use_mint_burn: bool) -> ChainSetup<'a> {
    let owner = Address::generate(env);

    // Create native token FIRST - this must match the endpoint's NATIVE_TOKEN constant
    let sac = env.register_stellar_asset_contract_v2(owner.clone());
    let native_token = sac.address();

    // Generate fee_collector AFTER native_token to not affect the address derivation
    let fee_collector = Address::generate(env);

    // Create ZRO token
    let zro_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let zro_token = zro_sac.address();

    // Create OFT token (SAC) and a mock SAC wrapper that implements Mintable.
    let oft_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let oft_token = oft_sac.address();
    let sac_wrapper_address = env.register(MockSacWrapper, (&oft_token,));

    let mode = if use_mint_burn {
        env.mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &oft_token,
                fn_name: "set_admin",
                args: (&sac_wrapper_address,).into_val(env),
                sub_invokes: &[],
            },
        }]);
        StellarAssetClient::new(env, &oft_token).set_admin(&sac_wrapper_address);
        OftType::MintBurn(sac_wrapper_address.clone())
    } else {
        OftType::LockUnlock
    };

    let eid: u32 = 30400; // Test EID
    let endpoint_address = env.register(EndpointV2, (&owner, eid, &native_token));
    let fee_recipient = Address::generate(env);
    let sml_address = env.register(SimpleMessageLib, (&owner, &endpoint_address, &fee_recipient));
    let delegate: Option<Address> = Some(owner.clone());
    let shared_decimals: u32 = 6;
    let oft_address =
        env.register(OFT, (&oft_token, &shared_decimals, &mode, &endpoint_address, delegate.as_ref().unwrap()));

    let endpoint = EndpointV2Client::new(env, &endpoint_address);
    let sml = SimpleMessageLibClient::new(env, &sml_address);
    let oft = OFTClient::new(env, &oft_address);

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
    ChainSetup {
        eid,
        owner,
        native_token,
        zro_token,
        oft_token,
        sac_wrapper: sac_wrapper_address,
        endpoint,
        sml,
        oft,
        fee_collector,
    }
}

pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let chain_a = setup_chain(&env, false);
    let chain_b = setup_chain(&env, true);

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
