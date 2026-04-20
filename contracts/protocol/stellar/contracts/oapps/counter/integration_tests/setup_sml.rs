extern crate std;

use crate::{
    counter::{Counter, CounterClient},
    integration_tests::utils::{
        address_to_bytes32, decode_packet, register_library, set_peer, set_zro, ChainSetupCommon,
    },
};
use endpoint_v2::{EndpointV2, EndpointV2Client, OutboundPacket};
use message_lib_common::packet_codec_v1;
use simple_message_lib::{SimpleMessageLib, SimpleMessageLibClient};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, Env, IntoVal,
};

pub struct ChainSetup<'a> {
    pub eid: u32,
    pub owner: Address,
    pub native_token: Address,
    pub endpoint: EndpointV2Client<'a>,
    pub sml: SimpleMessageLibClient<'a>,
    pub counter: CounterClient<'a>,
}

impl<'a> ChainSetupCommon<'a> for ChainSetup<'a> {
    fn counter(&self) -> &CounterClient<'a> {
        &self.counter
    }
    fn endpoint(&self) -> &EndpointV2Client<'a> {
        &self.endpoint
    }
    fn native_token(&self) -> &Address {
        &self.native_token
    }
    fn owner(&self) -> &Address {
        &self.owner
    }
    fn validate_packet(&self, env: &Env, packet_event: &(Bytes, Bytes, Address)) -> OutboundPacket {
        let packet = decode_packet(env, &packet_event.0);
        let encoded_header = packet_codec_v1::encode_packet_header(env, &packet);
        let payload_hash = packet_codec_v1::payload_hash(env, &packet);

        env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.sml.address,
                fn_name: "validate_packet",
                args: (&encoded_header, &payload_hash).into_val(env),
                sub_invokes: &[],
            },
        }]);
        self.sml.validate_packet(&encoded_header, &payload_hash);
        packet
    }
}

pub struct TestSetup<'a> {
    pub env: Env,

    pub chain_a: ChainSetup<'a>,
    pub chain_b: ChainSetup<'a>,
}

fn setup_chain<'a>(env: &Env, owner: &Address) -> ChainSetup<'a> {
    // Create native token for endpoint fees
    let native_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let native_token = native_sac.address();

    // Create ZRO token for endpoint fees
    let zro_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let zro_token = zro_sac.address();

    let eid: u32 = 30400; // Test EID
    let endpoint_address = env.register(EndpointV2, (owner, eid, &native_token));
    let fee_recipient = Address::generate(env);
    let sml_address = env.register(SimpleMessageLib, (owner, &endpoint_address, &fee_recipient));
    let counter_address = env.register(Counter, (owner, &endpoint_address, owner));

    let endpoint = EndpointV2Client::new(env, &endpoint_address);
    let sml = SimpleMessageLibClient::new(env, &sml_address);
    let counter = CounterClient::new(env, &counter_address);

    set_zro(env, owner, &endpoint, &zro_token);
    register_library(env, owner, &endpoint, &sml.address);
    ChainSetup { owner: owner.clone(), endpoint, sml, counter, eid, native_token }
}

pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let owner = Address::generate(&env);

    let chain_a = setup_chain(&env, &owner);
    let chain_b = setup_chain(&env, &owner);

    TestSetup { env, chain_a, chain_b }
}

pub fn wired_setup<'a>() -> TestSetup<'a> {
    let test_setup = setup();
    wire_endpoint(&test_setup.env, &[&test_setup.chain_a, &test_setup.chain_b]);
    wire_counter(&test_setup.env, &[&test_setup.chain_a, &test_setup.chain_b]);
    test_setup
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

pub fn wire_counter(env: &Env, chains: &[&ChainSetup<'_>]) {
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }
            set_peer(
                env,
                &chain.owner,
                &chain.counter,
                other_chain.eid,
                &address_to_bytes32(&other_chain.counter.address),
            );
        }
    }
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
