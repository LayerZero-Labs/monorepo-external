//! Test setup for SimpleMessageLib tests.

use endpoint_v2::{LayerZeroEndpointV2Client, Origin, OutboundPacket};
use soroban_sdk::{contract, contractimpl, symbol_short, testutils::Address as _, Address, Bytes, BytesN, Env};

use crate::simple_message_lib::{SimpleMessageLib, SimpleMessageLibClient};

// ============================================================================
// Mock Contracts
// ============================================================================

#[contract]
pub struct MockEndpoint;

#[contractimpl]
impl MockEndpoint {
    pub fn __constructor(env: Env, native_token: Address) {
        env.storage().instance().set(&symbol_short!("ntk"), &native_token);
    }

    pub fn eid(_env: Env) -> u32 {
        1
    }

    pub fn native_token(env: Env) -> Address {
        env.storage().instance().get(&symbol_short!("ntk")).unwrap()
    }

    pub fn zro(env: Env) -> Option<Address> {
        env.storage().instance().get(&symbol_short!("zro")).unwrap_or(None)
    }

    pub fn set_zro(env: Env, zro: Address) {
        env.storage().instance().set(&symbol_short!("zro"), &zro);
    }

    // Minimal `verify` implementation so `SimpleMessageLib::validate_packet` can be unit-tested.
    // Stores the last arguments for assertions.
    pub fn verify(env: Env, receive_lib: Address, origin: Origin, receiver: Address, payload_hash: BytesN<32>) {
        receive_lib.require_auth();

        env.storage().instance().set(&symbol_short!("v_rl"), &receive_lib);
        env.storage().instance().set(&symbol_short!("v_or"), &origin);
        env.storage().instance().set(&symbol_short!("v_rc"), &receiver);
        env.storage().instance().set(&symbol_short!("v_ph"), &payload_hash);
    }

    pub fn last_verify(env: Env) -> (Address, Origin, Address, BytesN<32>) {
        let receive_lib: Address = env.storage().instance().get(&symbol_short!("v_rl")).unwrap();
        let origin: Origin = env.storage().instance().get(&symbol_short!("v_or")).unwrap();
        let receiver: Address = env.storage().instance().get(&symbol_short!("v_rc")).unwrap();
        let payload_hash: BytesN<32> = env.storage().instance().get(&symbol_short!("v_ph")).unwrap();
        (receive_lib, origin, receiver, payload_hash)
    }
}

#[contract]
pub struct DummyReceiver;

#[contractimpl]
impl DummyReceiver {
    pub fn __constructor(_env: Env) {}
}

// ============================================================================
// Test Setup
// ============================================================================

pub struct TestSetup<'a> {
    pub env: Env,
    pub owner: Address,
    pub fee_recipient: Address,
    pub endpoint: LayerZeroEndpointV2Client<'a>,
    pub sml: SimpleMessageLibClient<'a>,
}

/// Creates a test setup with the SimpleMessageLib contract and MockEndpoint.
pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let owner = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    let native_token = env.register_stellar_asset_contract_v2(owner.clone());

    let endpoint = env.register(MockEndpoint, (&native_token.address(),));
    let endpoint_client = LayerZeroEndpointV2Client::new(&env, &endpoint);
    let sml_address = env.register(SimpleMessageLib, (&owner, &endpoint, &fee_recipient));
    let sml = SimpleMessageLibClient::new(&env, &sml_address);
    TestSetup { env, owner, fee_recipient, endpoint: endpoint_client, sml }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Creates a test outbound packet.
pub fn create_packet(env: &Env) -> OutboundPacket {
    create_packet_with_contract_receiver(env, BytesN::from_array(env, &[0u8; 32]))
}

/// Creates a contract receiver and returns both the address and its bytes representation.
pub fn create_contract_receiver(env: &Env) -> (Address, BytesN<32>) {
    use soroban_sdk::address_payload::AddressPayload;

    let receiver_addr = env.register(DummyReceiver, ());
    let receiver_bytes = match receiver_addr.to_payload().unwrap() {
        AddressPayload::ContractIdHash(b) => b,
        AddressPayload::AccountIdPublicKeyEd25519(_) => panic!("receiver must be a contract"),
    };
    (receiver_addr, receiver_bytes)
}

/// Creates a test outbound packet with a custom contract receiver.
pub fn create_packet_with_contract_receiver(env: &Env, receiver: BytesN<32>) -> OutboundPacket {
    OutboundPacket {
        nonce: 1,
        src_eid: 2,
        sender: Address::generate(env),
        dst_eid: 3,
        receiver,
        guid: BytesN::from_array(env, &[0u8; 32]),
        message: Bytes::from_array(env, b"test"),
    }
}
