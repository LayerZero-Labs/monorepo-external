use soroban_sdk::{Bytes, Env, U256};
use utils::option_ext::OptionExt;

use crate::{errors::CounterError, u256_ext::U256Ext};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MsgType {
    Vanilla = 1,
    Composed = 2,
    #[allow(clippy::upper_case_acronyms)]
    ABA = 3,
    ComposedABA = 4,
}

impl From<u8> for MsgType {
    fn from(value: u8) -> Self {
        match value {
            1 => MsgType::Vanilla,
            2 => MsgType::Composed,
            3 => MsgType::ABA,
            4 => MsgType::ComposedABA,
            _ => panic!("invalid msg type"),
        }
    }
}

pub const _MSG_TYPE_OFFSET: u8 = 0;
pub const SRC_EID_OFFSET: u8 = 1;
pub const VALUE_OFFSET: u8 = 5;

pub fn encode(env: &Env, msg_type: MsgType, src_eid: u32) -> Bytes {
    let msg_type: u8 = msg_type as u8;

    let mut data = Bytes::new(env);
    data.extend_from_array(&msg_type.to_be_bytes());
    data.extend_from_array(&src_eid.to_be_bytes());

    data
}

pub fn encode_with_value(env: &Env, msg_type: MsgType, src_eid: u32, value: u32) -> Bytes {
    let mut data = encode(env, msg_type, src_eid);
    data.append(&U256::from_u32(env, value).to_be_bytes());
    data
}

pub fn msg_type(data: &Bytes) -> MsgType {
    data.get(0).unwrap_or_else(|| panic!("cannot get msg type")).into()
}

pub fn src_eid(data: &Bytes) -> u32 {
    let mut src_eid_bytes = [0u8; 4];
    data.slice((SRC_EID_OFFSET as u32)..(VALUE_OFFSET as u32)).copy_into_slice(&mut src_eid_bytes);
    u32::from_be_bytes(src_eid_bytes)
}

pub fn value(env: &Env, data: &Bytes) -> i128 {
    let slice = data.slice((VALUE_OFFSET as u32)..data.len());
    let value = if slice.is_empty() { U256::from_u32(env, 0) } else { U256::from_be_bytes(env, &slice) };
    value.to_i128().unwrap_or_panic(env, CounterError::InvalidMsgValue)
}
