use crate::{Origin, Timeout};
use soroban_sdk::{contractevent, Address, Bytes, BytesN};

// ============================================================================
// EndpointV2 Events
// ============================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketSent {
    pub encoded_packet: Bytes,
    pub options: Bytes,
    pub send_library: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketVerified {
    #[topic]
    pub origin: Origin,
    #[topic]
    pub receiver: Address,
    pub payload_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketDelivered {
    #[topic]
    pub origin: Origin,
    #[topic]
    pub receiver: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LzReceiveAlert {
    #[topic]
    pub receiver: Address,
    #[topic]
    pub executor: Address,
    #[topic]
    pub origin: Origin,
    #[topic]
    pub guid: BytesN<32>,
    pub gas: i128,
    pub value: i128,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub reason: Bytes,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZroSet {
    pub zro: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegateSet {
    #[topic]
    pub oapp: Address,
    pub delegate: Option<Address>,
}

// ============================================================================
// Messaging Channel Events
// ============================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InboundNonceSkipped {
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub sender: BytesN<32>,
    #[topic]
    pub receiver: Address,
    #[topic]
    pub nonce: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketNilified {
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub sender: BytesN<32>,
    #[topic]
    pub receiver: Address,
    #[topic]
    pub nonce: u64,
    pub payload_hash: Option<BytesN<32>>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketBurnt {
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub sender: BytesN<32>,
    #[topic]
    pub receiver: Address,
    #[topic]
    pub nonce: u64,
    pub payload_hash: BytesN<32>,
}

// ============================================================================
// Message Lib Manager Events
// ============================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LibraryRegistered {
    pub new_lib: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultSendLibrarySet {
    #[topic]
    pub dst_eid: u32,
    pub new_lib: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultReceiveLibrarySet {
    #[topic]
    pub src_eid: u32,
    pub new_lib: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultReceiveLibTimeoutSet {
    #[topic]
    pub src_eid: u32,
    pub timeout: Option<Timeout>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SendLibrarySet {
    #[topic]
    pub sender: Address,
    #[topic]
    pub dst_eid: u32,
    pub new_lib: Option<Address>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiveLibrarySet {
    #[topic]
    pub receiver: Address,
    #[topic]
    pub src_eid: u32,
    pub new_lib: Option<Address>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiveLibraryTimeoutSet {
    #[topic]
    pub receiver: Address,
    #[topic]
    pub eid: u32,
    pub timeout: Option<Timeout>,
}

// ============================================================================
// Message Composer Events
// ============================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComposeSent {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    #[topic]
    pub guid: BytesN<32>,
    #[topic]
    pub index: u32,
    pub message: Bytes,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComposeDelivered {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    #[topic]
    pub guid: BytesN<32>,
    #[topic]
    pub index: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LzComposeAlert {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    #[topic]
    pub executor: Address,
    #[topic]
    pub guid: BytesN<32>,
    #[topic]
    pub index: u32,
    pub gas: i128,
    pub value: i128,
    pub message: Bytes,
    pub extra_data: Bytes,
    pub reason: Bytes,
}
