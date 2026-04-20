use common_macros::storage;
use soroban_sdk::BytesN;

#[storage]
pub enum CounterStorage {
    #[instance(u32)]
    EID,

    #[persistent(u64)]
    #[default(0)]
    MaxReceivedNonce { eid: u32, sender: BytesN<32> }, // (eid, sender) => nonce

    #[instance(bool)]
    #[default(false)]
    OrderedNonce,

    #[instance(u64)]
    #[default(0)]
    Count,

    #[instance(u64)]
    #[default(0)]
    ComposedCount,

    #[persistent(u64)]
    #[default(0)]
    InboundCount { eid: u32 },

    #[persistent(u64)]
    #[default(0)]
    OutboundCount { eid: u32 },
}
