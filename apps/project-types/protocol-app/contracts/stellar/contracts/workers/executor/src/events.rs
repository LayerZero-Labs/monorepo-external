use endpoint_v2::Origin;
use soroban_sdk::{contractevent, Address, Vec};

use crate::interfaces::{NativeDropParams, SetDstConfigParam};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DstConfigSet {
    pub params: Vec<SetDstConfigParam>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeDropApplied {
    pub origin: Origin,
    pub dst_eid: u32,
    pub oapp: Address,
    pub native_drop_params: Vec<NativeDropParams>,
    pub success: Vec<bool>,
}
