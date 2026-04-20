use crate::{
    interfaces::{OAppExecutorConfig, OAppUlnConfig, SetDefaultUlnConfigParam},
    SetDefaultExecutorConfigParam,
};
use endpoint_v2::FeeRecipient;
use soroban_sdk::{contractevent, Address, Bytes, BytesN, Vec};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutorConfigSet {
    #[topic]
    pub sender: Address,
    #[topic]
    pub dst_eid: u32,
    pub config: Option<OAppExecutorConfig>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SendUlnConfigSet {
    #[topic]
    pub sender: Address,
    #[topic]
    pub dst_eid: u32,
    pub config: Option<OAppUlnConfig>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiveUlnConfigSet {
    #[topic]
    pub receiver: Address,
    #[topic]
    pub src_eid: u32,
    pub config: Option<OAppUlnConfig>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultExecutorConfigsSet {
    pub params: Vec<SetDefaultExecutorConfigParam>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultSendUlnConfigsSet {
    pub params: Vec<SetDefaultUlnConfigParam>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultReceiveUlnConfigsSet {
    pub params: Vec<SetDefaultUlnConfigParam>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutorFeePaid {
    #[topic]
    pub executor: Address,
    #[topic]
    pub guid: BytesN<32>,
    pub fee: FeeRecipient,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DVNFeePaid {
    #[topic]
    pub guid: BytesN<32>,
    pub dvns: Vec<Address>,
    pub fees: Vec<FeeRecipient>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayloadVerified {
    #[topic]
    pub dvn: Address,
    pub header: Bytes,
    pub confirmations: u64,
    pub proof_hash: BytesN<32>,
}
