use soroban_sdk::{contractevent, BytesN};

/// Event published when the seed is set or updated
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SeedSet {
    pub seed: BytesN<32>,
}

/// Event published when a transaction is executed
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionExecuted {
    pub merkle_root: BytesN<32>,
    pub nonce: u64,
}

/// Event published when an executor is added or removed
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutorSet {
    #[topic]
    pub executor: BytesN<32>,
    pub active: bool,
}

/// Event published when executor requirement is toggled
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutorRequiredSet {
    pub required: bool,
}
