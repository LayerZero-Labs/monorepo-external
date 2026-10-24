use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;

const MSG_TYPE_OFFSET: usize = 0;
const SRC_EID_OFFSET: usize = 1;
const VALUE_OFFSET: usize = 5;

pub fn encode(msg_type: u8, src_eid: u32) -> ByteArray {
    let mut message: ByteArray = Default::default();
    message.append_u8(msg_type);
    message.append_u32(src_eid);
    message
}

pub fn encode_with_value(msg_type: u8, src_eid: u32, value: u256) -> ByteArray {
    let mut message: ByteArray = Default::default();
    message.append_u8(msg_type);
    message.append_u32(src_eid);
    message.append_u256(value);
    message
}

pub fn msg_type(message: @ByteArray) -> u8 {
    let (_, type_value) = message.read_u8(MSG_TYPE_OFFSET);
    type_value
}

pub fn src_eid(message: @ByteArray) -> u32 {
    let (_, eid_value) = message.read_u32(SRC_EID_OFFSET);
    eid_value
}

pub fn value(message: @ByteArray) -> u256 {
    if message.len() <= VALUE_OFFSET {
        return 0;
    }

    let (_, value_data) = message.read_u256(VALUE_OFFSET);
    value_data
}
