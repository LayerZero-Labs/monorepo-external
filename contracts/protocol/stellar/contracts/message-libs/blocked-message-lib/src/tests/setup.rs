//! Test setup for BlockedMessageLib tests.

use endpoint_v2::OutboundPacket;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

use crate::{BlockedMessageLib, BlockedMessageLibClient};

// ============================================================================
// Test Setup
// ============================================================================

pub struct TestSetup<'a> {
    pub env: Env,
    pub client: BlockedMessageLibClient<'a>,
}

/// Creates a test setup with the BlockedMessageLib contract.
pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    let contract_id = env.register(BlockedMessageLib, ());
    let client = BlockedMessageLibClient::new(&env, &contract_id);
    TestSetup { env, client }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Creates a test outbound packet.
pub fn create_packet(env: &Env) -> OutboundPacket {
    OutboundPacket {
        nonce: 1,
        src_eid: 1,
        sender: Address::generate(env),
        dst_eid: 2,
        receiver: BytesN::from_array(env, &[0u8; 32]),
        guid: BytesN::from_array(env, &[0u8; 32]),
        message: Bytes::from_array(env, b"test"),
    }
}
