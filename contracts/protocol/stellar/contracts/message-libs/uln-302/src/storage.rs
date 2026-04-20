use crate::interfaces::{ExecutorConfig, OAppExecutorConfig, OAppUlnConfig, UlnConfig};
use common_macros::storage;
use soroban_sdk::{Address, BytesN};

/// Storage for the Uln302 message library.
#[storage]
pub enum UlnStorage {
    /// The endpoint address (immutable, set once in constructor)
    #[instance(Address)]
    Endpoint,

    /// The treasury address for fee collection (immutable, set once in constructor)
    #[instance(Address)]
    Treasury,

    /// The default executor configurations for a destination endpoint.
    #[persistent(ExecutorConfig)]
    DefaultExecutorConfigs { dst_eid: u32 },

    /// The default send ULN configurations for a destination endpoint.
    #[persistent(UlnConfig)]
    DefaultSendUlnConfigs { dst_eid: u32 },

    /// The default receive ULN configurations for a source endpoint.
    #[persistent(UlnConfig)]
    DefaultReceiveUlnConfigs { src_eid: u32 },

    /// The OApp-specific executor configurations for a sender and destination endpoint
    #[persistent(OAppExecutorConfig)]
    #[name("oapp_executor_configs")]
    OAppExecutorConfigs { sender: Address, dst_eid: u32 },

    /// The OApp-specific send ULN configurations for a sender and destination endpoint
    #[persistent(OAppUlnConfig)]
    #[name("oapp_send_uln_configs")]
    OAppSendUlnConfigs { sender: Address, dst_eid: u32 },

    /// The OApp-specific receive ULN configurations for a receiver and source endpoint
    #[persistent(OAppUlnConfig)]
    #[name("oapp_receive_uln_configs")]
    OAppReceiveUlnConfigs { receiver: Address, src_eid: u32 },

    /// The confirmations for a DVN for a given header hash and payload hash
    #[persistent(u64)]
    Confirmations { dvn: Address, header_hash: BytesN<32>, payload_hash: BytesN<32> },
}
