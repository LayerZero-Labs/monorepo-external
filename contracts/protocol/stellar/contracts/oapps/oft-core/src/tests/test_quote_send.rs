use crate::{errors::OFTError, types::SendParam};
use oapp::OAppError;
use soroban_sdk::{bytes, testutils::Address as _, Address, Bytes, BytesN, Env};

use super::test_utils::{create_send_param, OFTTestSetup};

#[test]
fn test_quote_send_basic() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set peer
    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // SAC has 7 decimals, shared is 6, conversion rate = 10
    // Use amount with no dust
    let amount_ld = 12345670i128;
    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);

    // Quote send without ZRO
    let fee = setup.oft.quote_send(&sender, &send_param, &false);
    assert_eq!(fee.native_fee, setup.native_fee);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_send_with_zro() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345670i128;
    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);

    // Quote send with ZRO
    let fee = setup.oft.quote_send(&sender, &send_param, &true);
    assert_eq!(fee.native_fee, setup.native_fee);
    assert_eq!(fee.zro_fee, setup.zro_fee);
}

#[test]
fn test_quote_send_different_amounts() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Test with different amounts (all divisible by conversion rate to avoid dust)
    let conversion_rate = setup.oft.decimal_conversion_rate();
    for amount in [100i128, 1000, 10000, 100000, 1000000] {
        let dust_removed = (amount / conversion_rate) * conversion_rate;
        let send_param = create_send_param(&env, dst_eid, amount, dust_removed);
        let fee = setup.oft.quote_send(&sender, &send_param, &false);
        assert_eq!(fee.native_fee, setup.native_fee);
    }
}

#[test]
fn test_quote_send_multiple_destinations() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Set multiple peers
    let dst_eids = [1u32, 100, 200, 300];
    for eid in dst_eids.iter() {
        let peer = BytesN::from_array(&env, &[*eid as u8; 32]);
        setup.set_peer(*eid, &peer);
    }

    let amount_ld = 12345670i128;

    // Test quote for each destination
    for dst_eid in dst_eids.iter() {
        let send_param = create_send_param(&env, *dst_eid, amount_ld, amount_ld);
        let fee = setup.oft.quote_send(&sender, &send_param, &false);
        assert_eq!(fee.native_fee, setup.native_fee);
        assert_eq!(fee.zro_fee, 0);
    }
}

#[test]
fn test_quote_send_no_peer_set() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    // Don't set peer - should fail
    let amount_ld = 12345670i128;
    let send_param = create_send_param(&env, 100, amount_ld, amount_ld);

    let result = setup.oft.try_quote_send(&sender, &send_param, &false);
    assert_eq!(result.err().unwrap().ok().unwrap(), OAppError::NoPeer.into());
}

#[test]
fn test_quote_send_with_compose_msg() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Create send param with compose message
    let amount_ld = 12345670i128;
    let send_param = SendParam {
        dst_eid,
        to: BytesN::from_array(&env, &[1u8; 32]),
        amount_ld,
        min_amount_ld: amount_ld,
        extra_options: bytes!(&env),
        compose_msg: Bytes::from_array(&env, b"test compose msg"),
        oft_cmd: bytes!(&env),
    };

    let fee = setup.oft.quote_send(&sender, &send_param, &false);
    assert_eq!(fee.native_fee, setup.native_fee);
}

#[test]
fn test_quote_send_slippage_exceeded() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let amount_ld = 12345678i128;
    // min_amount_ld is higher than what can be received after dust removal
    let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);

    let result = setup.oft.try_quote_send(&sender, &send_param, &false);
    assert_eq!(result.err().unwrap().ok().unwrap(), OFTError::SlippageExceeded.into());
}

#[test]
fn test_quote_send_zero_amount() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    let send_param = create_send_param(&env, dst_eid, 0, 0);

    let fee = setup.oft.quote_send(&sender, &send_param, &false);
    assert_eq!(fee.native_fee, setup.native_fee);
    assert_eq!(fee.zro_fee, 0);
}

#[test]
fn test_quote_send_with_dust_removal() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let sender = Address::generate(&env);

    let peer = BytesN::from_array(&env, &[2u8; 32]);
    let dst_eid = 100u32;
    setup.set_peer(dst_eid, &peer);

    // Amount with dust that will be removed
    let amount_ld = 12345678i128;
    let conversion_rate = setup.oft.decimal_conversion_rate();
    let dust_removed = (amount_ld / conversion_rate) * conversion_rate;
    let send_param = create_send_param(&env, dst_eid, amount_ld, dust_removed);

    let fee = setup.oft.quote_send(&sender, &send_param, &false);
    assert_eq!(fee.native_fee, setup.native_fee);
    assert_eq!(fee.zro_fee, 0);
}
