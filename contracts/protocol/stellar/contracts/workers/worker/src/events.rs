use soroban_sdk::{contractevent, Address, Bytes};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetAdmin {
    pub admin: Address,
    pub active: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetSupportedMessageLib {
    pub message_lib: Address,
    pub supported: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetAllowlist {
    pub oapp: Address,
    pub allowed: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetDenylist {
    pub oapp: Address,
    pub denied: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paused {
    pub pauser: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unpaused {
    pub unpauser: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetDefaultMultiplierBps {
    pub multiplier_bps: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetDepositAddress {
    pub deposit_address: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetPriceFeed {
    pub price_feed: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetSupportedOptionTypes {
    pub dst_eid: u32,
    pub option_types: Bytes,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetWorkerFeeLib {
    pub fee_lib: Address,
}
