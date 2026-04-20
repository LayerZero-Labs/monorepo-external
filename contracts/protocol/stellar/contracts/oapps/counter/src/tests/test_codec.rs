use crate::codec::*;
use soroban_sdk::{Bytes, Env};

#[test]
fn test_encode_and_decode() {
    let env = Env::default();
    let _msg_type = 1;
    let _src_eid = 1;
    let data = encode(&env, _msg_type.into(), _src_eid);
    assert_eq!(msg_type(&data), MsgType::from(_msg_type));
    assert_eq!(src_eid(&data), _src_eid);
}

#[test]
fn test_encode_and_decode_with_value() {
    let env = Env::default();
    let _msg_type = 1;
    let _src_eid = 1;
    let _value = 100u32;
    let data = encode_with_value(&env, _msg_type.into(), _src_eid, _value);
    assert_eq!(msg_type(&data), MsgType::from(_msg_type));
    assert_eq!(src_eid(&data), _src_eid);
    assert_eq!(value(&env, &data), _value as i128);
}

#[test]
fn test_msg_type() {
    let env = Env::default();
    let _msg_type = 1;
    let data = encode(&env, _msg_type.into(), 1);
    assert_eq!(msg_type(&data), MsgType::from(_msg_type));
}

#[test]
fn test_zero_value_when_not_provided() {
    let env = Env::default();
    let data = encode(&env, 1.into(), 1);
    assert_eq!(value(&env, &data), 0i128);
}

#[test]
#[should_panic(expected = "cannot get msg type")]
fn test_msg_type_panic_on_invalid_data() {
    let env = Env::default();
    let data = Bytes::new(&env);
    msg_type(&data);
}

#[test]
#[should_panic(expected = "object index out of bounds")]
fn test_src_eid_panic_on_invalid_data() {
    let env = Env::default();
    let data = Bytes::new(&env);
    src_eid(&data);
}

#[test]
#[should_panic(expected = "expected fixed-length bytes slice, got slice with different size")]
fn test_value_panic_on_short_value() {
    let env = Env::default();
    let mut data = encode(&env, 1.into(), 1);
    data.extend_from_array(&[0u8; 3]);
    value(&env, &data);
}
