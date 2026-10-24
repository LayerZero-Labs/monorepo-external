use layerzero::endpoint::constants::{EMPTY_PAYLOAD_HASH, NIL_PAYLOAD_HASH};
use layerzero::message_lib::uln_302::ultra_light_node_302::UltraLightNode302::EMPTY_VERIFICATION;
use lz_utils::bytes::Bytes32;
use crate::constants::assert_eq;

#[test]
fn empty_payload_hash_should_be_default() {
    assert_eq(EMPTY_PAYLOAD_HASH, Default::default());
}

#[test]
fn nil_payload_hash_should_be_max_u256() {
    assert_eq(NIL_PAYLOAD_HASH, Bytes32 { value: core::num::traits::Bounded::<u256>::MAX });
}

#[test]
fn empty_verification_should_be_default() {
    assert_eq(EMPTY_VERIFICATION, Default::default());
}
