use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OFTSent {
    #[topic]
    pub guid: BytesN<32>,
    #[topic]
    pub dst_eid: u32,
    #[topic]
    pub from: Address,
    pub amount_sent_ld: i128,
    pub amount_received_ld: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OFTReceived {
    #[topic]
    pub guid: BytesN<32>,
    #[topic]
    pub src_eid: u32,
    #[topic]
    pub to: Address,
    pub amount_received_ld: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MsgInspectorSet {
    pub inspector: Option<Address>,
}
