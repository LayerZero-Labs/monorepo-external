use crate::Timeout;
use common_macros::storage;
use soroban_sdk::{Address, BytesN, Vec};

#[storage]
pub enum EndpointStorage {
    /// The endpoint ID for this chain
    #[instance(u32)]
    Eid,

    /// The native token address used for messaging fee payments
    #[instance(Address)]
    NativeToken,

    /// The ZRO token address
    #[instance(Address)]
    Zro,

    /// The delegate address for an OApp
    #[persistent(Address)]
    Delegate { oapp: Address },

    /// ============================================================================================
    /// Messaging Channel
    /// ============================================================================================

    /// Sorted list of out-of-order verified nonces
    #[persistent(Vec<u64>)]
    #[default(Vec::new(env))]
    PendingInboundNonces { receiver: Address, src_eid: u32, sender: BytesN<32> },

    /// The current inbound nonce for a receiver
    #[persistent(u64)]
    #[default(0)]
    InboundNonce { receiver: Address, src_eid: u32, sender: BytesN<32> },

    /// The inbound payload hash for a receiver
    #[persistent(BytesN<32>)]
    InboundPayloadHash { receiver: Address, src_eid: u32, sender: BytesN<32>, nonce: u64 },

    /// The outbound nonce for a sender
    #[persistent(u64)]
    #[default(0)]
    OutboundNonce { sender: Address, dst_eid: u32, receiver: BytesN<32> },

    /// ============================================================================================
    /// Message Lib Manager
    /// ============================================================================================

    /// The number of registered libraries
    #[instance(u32)]
    #[default(0)]
    RegisteredLibrariesCount,

    /// The mapping of library to index
    #[persistent(u32)]
    LibraryToIndex { lib: Address },

    /// The mapping of index to library
    #[persistent(Address)]
    IndexToLibrary { index: u32 },

    /// The default send library for a destination endpoint
    #[persistent(Address)]
    DefaultSendLibrary { dst_eid: u32 },

    /// The default receive library for a source endpoint
    #[persistent(Address)]
    DefaultReceiveLibrary { src_eid: u32 },

    /// The default receive library grace period for a source endpoint
    #[persistent(Timeout)]
    DefaultReceiveLibraryTimeout { src_eid: u32 },

    /// The custom send library for a sender and destination endpoint
    #[persistent(Address)]
    SendLibrary { sender: Address, dst_eid: u32 },

    /// The custom receive library for a receiver and source endpoint
    #[persistent(Address)]
    ReceiveLibrary { receiver: Address, src_eid: u32 },

    /// The custom receive library grace period for a receiver and source endpoint
    #[persistent(Timeout)]
    ReceiveLibraryTimeout { receiver: Address, src_eid: u32 },

    /// ============================================================================================
    /// Messaging Composer
    /// ============================================================================================

    /// The compose queue for a sender and receiver
    #[persistent(BytesN<32>)]
    ComposeQueue { from: Address, to: Address, guid: BytesN<32>, index: u32 },
}
