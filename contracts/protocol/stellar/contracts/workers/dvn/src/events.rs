use crate::DstConfigParam;
use soroban_sdk::{contractevent, Address, Vec};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetDstConfig {
    pub params: Vec<DstConfigParam>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetUpgrader {
    pub upgrader: Option<Address>,
}
