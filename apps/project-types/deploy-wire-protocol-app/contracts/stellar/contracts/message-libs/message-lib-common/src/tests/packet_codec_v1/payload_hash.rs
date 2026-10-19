use super::test_helper::*;
use crate::packet_codec_v1::{payload, payload_hash};
use endpoint_v2::util::keccak256;
use soroban_sdk::Env;

#[test]
fn test_payload_hash_matches_keccak256_of_payload() {
    let env = Env::default();
    let packet = create_test_outbound_packet(&env);

    let payload_bytes = payload(&env, &packet);
    let expected = keccak256(&env, &payload_bytes);

    assert_eq!(payload_hash(&env, &packet), expected);
}
