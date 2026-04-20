//! Test setup and mock contracts for LayerZero view tests.

use common_macros::contract_impl;
use endpoint_v2::{MessageLibClient, Origin, OutboundPacket, SetConfigParam};
use message_lib_common::packet_codec_v1;
use soroban_sdk::{
    address_payload::AddressPayload, contract, log, testutils::Address as _, Address, Bytes, BytesN, Env, Vec,
};

use crate::{LayerZeroView, LayerZeroViewClient};

pub const LOCAL_EID: u32 = 30010;
pub const REMOTE_EID: u32 = 30011;

// ============================================================================
// Mock Endpoint Contract
// ============================================================================

/// Mock endpoint that provides basic endpoint functionality for testing.
/// Uses simple setters to control return values - real endpoint logic is tested separately.
#[contract]
pub struct MockEndpoint;

mod endpoint_storage {
    use soroban_sdk::{contracttype, Address, BytesN};

    #[contracttype]
    pub enum MockEndpointStorage {
        // Simple return value controls
        Initializable(Address, u32, BytesN<32>),
        Verifiable(Address, u32, BytesN<32>),
        // State for executable tests
        InboundNonce(Address, u32, BytesN<32>),
        InboundPayloadHash(Address, u32, BytesN<32>, u64),
        ReceiveLibrary(Address, u32),
    }
}

#[contract_impl]
impl MockEndpoint {
    pub fn eid(_env: &Env) -> u32 {
        LOCAL_EID
    }

    pub fn set_config(env: &Env, _caller: &Address, oapp: &Address, lib: &Address, params: &Vec<SetConfigParam>) {
        let msglib = MessageLibClient::new(env, lib);
        msglib.set_config(oapp, params);
    }

    /// Returns initializable state - controlled by set_initializable setter.
    pub fn initializable(env: &Env, origin: &Origin, receiver: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&endpoint_storage::MockEndpointStorage::Initializable(
                receiver.clone(),
                origin.src_eid,
                origin.sender.clone(),
            ))
            .unwrap_or(false)
    }

    /// Returns verifiable state - controlled by set_verifiable setter.
    pub fn verifiable(env: &Env, origin: &Origin, receiver: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&endpoint_storage::MockEndpointStorage::Verifiable(
                receiver.clone(),
                origin.src_eid,
                origin.sender.clone(),
            ))
            .unwrap_or(true) // Default true so tests can focus on other conditions
    }

    // =========================================================================
    // Setters for controlling mock behavior
    // =========================================================================

    /// Set what initializable() returns for a given path.
    pub fn set_initializable(env: &Env, receiver: &Address, src_eid: &u32, sender: &BytesN<32>, value: &bool) {
        env.storage().persistent().set(
            &endpoint_storage::MockEndpointStorage::Initializable(receiver.clone(), *src_eid, sender.clone()),
            value,
        );
    }

    /// Set what verifiable() returns for a given path.
    pub fn set_verifiable(env: &Env, receiver: &Address, src_eid: &u32, sender: &BytesN<32>, value: &bool) {
        env.storage()
            .persistent()
            .set(&endpoint_storage::MockEndpointStorage::Verifiable(receiver.clone(), *src_eid, sender.clone()), value);
    }

    pub fn set_inbound_nonce(env: &Env, receiver: &Address, src_eid: &u32, sender: &BytesN<32>, nonce: &u64) {
        env.storage().persistent().set(
            &endpoint_storage::MockEndpointStorage::InboundNonce(receiver.clone(), *src_eid, sender.clone()),
            nonce,
        );
    }

    pub fn set_inbound_payload_hash(
        env: &Env,
        receiver: &Address,
        src_eid: &u32,
        sender: &BytesN<32>,
        nonce: &u64,
        payload_hash: &Option<BytesN<32>>,
    ) {
        let key = endpoint_storage::MockEndpointStorage::InboundPayloadHash(
            receiver.clone(),
            *src_eid,
            sender.clone(),
            *nonce,
        );
        match payload_hash {
            Some(hash) => env.storage().persistent().set(&key, hash),
            None => env.storage().persistent().remove(&key),
        }
    }

    pub fn set_receive_library(env: &Env, receiver: &Address, src_eid: &u32, lib: &Address) {
        env.storage()
            .persistent()
            .set(&endpoint_storage::MockEndpointStorage::ReceiveLibrary(receiver.clone(), *src_eid), lib);
    }

    // =========================================================================
    // Getters required by LayerZeroView
    // =========================================================================

    pub fn inbound_nonce(env: &Env, receiver: &Address, src_eid: &u32, sender: &BytesN<32>) -> u64 {
        env.storage()
            .persistent()
            .get(&endpoint_storage::MockEndpointStorage::InboundNonce(receiver.clone(), *src_eid, sender.clone()))
            .unwrap_or(0)
    }

    pub fn inbound_payload_hash(
        env: &Env,
        receiver: &Address,
        src_eid: &u32,
        sender: &BytesN<32>,
        nonce: &u64,
    ) -> Option<BytesN<32>> {
        env.storage().persistent().get(&endpoint_storage::MockEndpointStorage::InboundPayloadHash(
            receiver.clone(),
            *src_eid,
            sender.clone(),
            *nonce,
        ))
    }

    pub fn is_valid_receive_library(env: &Env, receiver: &Address, src_eid: &u32, lib: &Address) -> bool {
        let stored_lib: Option<Address> = env
            .storage()
            .persistent()
            .get(&endpoint_storage::MockEndpointStorage::ReceiveLibrary(receiver.clone(), *src_eid));

        match stored_lib {
            Some(stored) => &stored == lib,
            None => true, // Default: any lib is valid if not set
        }
    }
}

// ============================================================================
// Mock ULN302 Contract (minimal for testing)
// ============================================================================

mod uln_storage {
    use soroban_sdk::{contracttype, BytesN};

    #[contracttype]
    pub enum MockUlnStorage {
        Owner,
        Endpoint,
        Treasury,
        // Simple return value control for verifiable()
        Verifiable(BytesN<32>, BytesN<32>), // (header_hash, payload_hash) -> bool
    }
}

#[contract]
pub struct MockUln302;

#[contract_impl]
impl MockUln302 {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, treasury: &Address) {
        env.storage().persistent().set(&uln_storage::MockUlnStorage::Owner, owner);
        env.storage().persistent().set(&uln_storage::MockUlnStorage::Endpoint, endpoint);
        env.storage().persistent().set(&uln_storage::MockUlnStorage::Treasury, treasury);
    }

    /// Returns verifiable state - controlled by set_verifiable setter.
    /// Default is false (Verifying state) unless explicitly set.
    pub fn verifiable(env: &Env, packet_header: &Bytes, payload_hash: &BytesN<32>) -> bool {
        let header_hash = endpoint_v2::util::keccak256(env, packet_header);
        env.storage()
            .persistent()
            .get(&uln_storage::MockUlnStorage::Verifiable(header_hash, payload_hash.clone()))
            .unwrap_or(false)
    }

    /// Set what verifiable() returns for a given packet header and payload hash.
    pub fn set_verifiable(env: &Env, packet_header: &Bytes, payload_hash: &BytesN<32>, value: &bool) {
        let header_hash = endpoint_v2::util::keccak256(env, packet_header);
        env.storage()
            .persistent()
            .set(&uln_storage::MockUlnStorage::Verifiable(header_hash, payload_hash.clone()), value);
    }
}

// ============================================================================
// Test Setup
// ============================================================================

pub struct TestSetup<'a> {
    pub env: Env,
    pub _owner: Address,
    pub endpoint: Address,
    pub endpoint_client: MockEndpointClient<'a>,
    pub uln302: Address,
    pub uln302_client: MockUln302Client<'a>,
    pub view_client: LayerZeroViewClient<'a>,
}

/// Creates a full test setup with endpoint, ULN302, and view contract.
pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let owner = Address::generate(&env);

    // Deploy mock endpoint
    let endpoint = env.register(MockEndpoint, ());
    let endpoint_client = MockEndpointClient::new(&env, &endpoint);

    // Deploy Mock ULN302 (treasury not needed for simplified mock)
    let treasury = Address::generate(&env);
    let uln302 = env.register(MockUln302, (&owner, &endpoint, &treasury));
    let uln302_client = MockUln302Client::new(&env, &uln302);

    // Deploy LayerZeroView
    let view = env.register(LayerZeroView, (&owner, &endpoint, &uln302));
    let view_client = LayerZeroViewClient::new(&env, &view);

    log!(&env, "owner: {}", owner);
    log!(&env, "endpoint: {}", endpoint);
    log!(&env, "uln302: {}", uln302);
    log!(&env, "view: {}", view);

    TestSetup { env, _owner: owner, endpoint, endpoint_client, uln302, uln302_client, view_client }
}

impl<'a> TestSetup<'a> {
    /// Register a mock OApp address.
    pub fn register_oapp(&self) -> Address {
        Address::generate(&self.env)
    }

    /// Set initializable return value for a path (endpoint mock).
    pub fn set_initializable(&self, receiver: &Address, src_eid: u32, sender: &Address, value: bool) {
        let sender_bytes32 = address_to_bytes32(sender);
        self.endpoint_client.set_initializable(receiver, &src_eid, &sender_bytes32, &value);
    }

    /// Set verifiable return value for a path (endpoint mock).
    pub fn set_verifiable(&self, receiver: &Address, src_eid: u32, sender: &Address, value: bool) {
        let sender_bytes32 = address_to_bytes32(sender);
        self.endpoint_client.set_verifiable(receiver, &src_eid, &sender_bytes32, &value);
    }

    /// Set inbound nonce (marks messages up to this nonce as verified and executable).
    pub fn set_inbound_nonce(&self, receiver: &Address, src_eid: u32, sender: &Address, nonce: u64) {
        let sender_bytes32 = address_to_bytes32(sender);
        self.endpoint_client.set_inbound_nonce(receiver, &src_eid, &sender_bytes32, &nonce);
    }

    /// Set payload hash for a specific message.
    pub fn set_payload_hash(
        &self,
        receiver: &Address,
        src_eid: u32,
        sender: &Address,
        nonce: u64,
        payload_hash: &Option<BytesN<32>>,
    ) {
        let sender_bytes32 = address_to_bytes32(sender);
        self.endpoint_client.set_inbound_payload_hash(receiver, &src_eid, &sender_bytes32, &nonce, payload_hash);
    }

    /// Set receive library for a receiver/src_eid combination.
    pub fn set_receive_library(&self, receiver: &Address, src_eid: u32, lib: &Address) {
        self.endpoint_client.set_receive_library(receiver, &src_eid, lib);
    }

    /// Set ULN302 verifiable return value for a packet header and payload hash.
    pub fn set_uln_verifiable(&self, packet_header: &Bytes, payload_hash: &BytesN<32>, value: bool) {
        self.uln302_client.set_verifiable(packet_header, payload_hash, &value);
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Extract BytesN<32> from an Address.
pub fn address_to_bytes32(address: &Address) -> BytesN<32> {
    match address.to_payload().unwrap() {
        AddressPayload::AccountIdPublicKeyEd25519(payload) => payload,
        AddressPayload::ContractIdHash(payload) => payload,
    }
}

/// Create a test packet header.
pub fn create_test_packet_header(env: &Env, receiver: &Address, sender: &Address, nonce: u64) -> Bytes {
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let message = Bytes::from_array(env, &[0x01, 0x02, 0x03, 0x04]);

    let packet = OutboundPacket {
        nonce,
        src_eid: REMOTE_EID,
        sender: sender.clone(),
        dst_eid: LOCAL_EID,
        receiver: address_to_bytes32(receiver),
        guid,
        message,
    };
    packet_codec_v1::encode_packet_header(env, &packet)
}

/// Create a test packet header with custom dst_eid.
pub fn create_test_packet_header_with_eid(
    env: &Env,
    receiver: &Address,
    sender: &Address,
    nonce: u64,
    dst_eid: u32,
) -> Bytes {
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let message = Bytes::from_array(env, &[0x01, 0x02, 0x03, 0x04]);

    let packet = OutboundPacket {
        nonce,
        src_eid: REMOTE_EID,
        sender: sender.clone(),
        dst_eid,
        receiver: address_to_bytes32(receiver),
        guid,
        message,
    };
    packet_codec_v1::encode_packet_header(env, &packet)
}

/// Create a test payload hash.
pub fn create_test_payload_hash(env: &Env) -> BytesN<32> {
    let random_data = Bytes::from_array(env, &[0xde, 0xad, 0xbe, 0xef]);
    endpoint_v2::util::keccak256(env, &random_data)
}
