use crate::errors::OFTError;
use soroban_sdk::Env;

use super::test_utils::{create_send_param, OFTTestSetup};

// ==================== Basic Quote OFT Tests ====================

#[test]
fn test_quote_oft_basic() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let conversion_rate = setup.oft.decimal_conversion_rate();
    let amount_ld = 12345670i128;
    let dust_removed = (amount_ld / conversion_rate) * conversion_rate; // No dust with last digit 0
    let send_param = create_send_param(&env, 1, amount_ld, dust_removed);

    let (limit, fees, receipt) = setup.oft.quote_oft(&setup.owner, &send_param);

    // Check limits
    assert_eq!(limit.min_amount_ld, 0);
    assert_eq!(limit.max_amount_ld, u64::MAX as i128);

    // Check fees (should be empty for basic OFT)
    assert_eq!(fees.len(), 0);

    // Check receipt
    assert_eq!(receipt.amount_sent_ld, dust_removed);
    assert_eq!(receipt.amount_received_ld, dust_removed);
}

#[test]
fn test_quote_oft_with_dust_removal() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let conversion_rate = setup.oft.decimal_conversion_rate();
    // Amount with dust that will be removed
    let amount_ld = 12345678i128;
    let dust_removed = (amount_ld / conversion_rate) * conversion_rate;
    let send_param = create_send_param(&env, 1, amount_ld, dust_removed);

    let (limit, fees, receipt) = setup.oft.quote_oft(&setup.owner, &send_param);

    // Check limits
    assert_eq!(limit.min_amount_ld, 0);
    assert_eq!(limit.max_amount_ld, u64::MAX as i128);

    // Check fees (should be empty for basic OFT)
    assert_eq!(fees.len(), 0);

    // Check receipt - dust removed
    assert_eq!(receipt.amount_sent_ld, dust_removed);
    assert_eq!(receipt.amount_received_ld, dust_removed);
}

#[test]
fn test_quote_oft_zero_amount() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let send_param = create_send_param(&env, 1, 0, 0);

    let (limit, fees, receipt) = setup.oft.quote_oft(&setup.owner, &send_param);

    assert_eq!(receipt.amount_sent_ld, 0);
    assert_eq!(receipt.amount_received_ld, 0);
    assert_eq!(limit.min_amount_ld, 0);
    assert_eq!(limit.max_amount_ld, u64::MAX as i128);
    assert_eq!(fees.len(), 0);
}

#[test]
fn test_quote_oft_dust_only_amount() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let conversion_rate = setup.oft.decimal_conversion_rate();
    // Amount that is entirely dust (less than conversion rate)
    let amount_ld = conversion_rate - 1; // Less than conversion rate
    let send_param = create_send_param(&env, 1, amount_ld, 0);

    let (_, _, receipt) = setup.oft.quote_oft(&setup.owner, &send_param);

    // All dust should be removed
    assert_eq!(receipt.amount_sent_ld, 0);
    assert_eq!(receipt.amount_received_ld, 0);
}

#[test]
fn test_quote_oft_different_dst_eids() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let amount_ld = 12345670i128; // No dust

    // Test with different destination EIDs
    for dst_eid in [1u32, 100, 10000, u32::MAX] {
        let send_param = create_send_param(&env, dst_eid, amount_ld, amount_ld);
        let (limit, fees, receipt) = setup.oft.quote_oft(&setup.owner, &send_param);

        // Results should be the same regardless of dst_eid
        assert_eq!(limit.min_amount_ld, 0);
        assert_eq!(limit.max_amount_ld, u64::MAX as i128);
        assert_eq!(fees.len(), 0);
        assert_eq!(receipt.amount_sent_ld, amount_ld);
        assert_eq!(receipt.amount_received_ld, amount_ld);
    }
}

#[test]
fn test_quote_oft_large_amounts() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Test with a large amount
    let amount_ld = 1_000_000_000_000_000_000i128;
    let send_param = create_send_param(&env, 1, amount_ld, amount_ld);

    let (limit, fees, receipt) = setup.oft.quote_oft(&setup.owner, &send_param);

    assert_eq!(limit.min_amount_ld, 0);
    assert_eq!(limit.max_amount_ld, u64::MAX as i128);
    assert_eq!(fees.len(), 0);
    assert_eq!(receipt.amount_sent_ld, amount_ld);
    assert_eq!(receipt.amount_received_ld, amount_ld);
}

// ==================== Slippage Tests ====================

#[test]
fn test_quote_oft_slippage_less_than_received() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let conversion_rate = setup.oft.decimal_conversion_rate();
    let amount_ld = 12345678i128;
    let dust_removed = (amount_ld / conversion_rate) * conversion_rate;
    // min_amount_ld is less than what will be received
    let send_param = create_send_param(&env, 1, amount_ld, dust_removed - conversion_rate);

    let (_, _, receipt) = setup.oft.quote_oft(&setup.owner, &send_param);

    assert_eq!(receipt.amount_sent_ld, dust_removed);
    assert_eq!(receipt.amount_received_ld, dust_removed);
}

#[test]
fn test_quote_oft_slippage_exceeded() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let amount_ld = 12345678i128;
    // min_amount_ld is higher than what can be received after dust removal
    let send_param = create_send_param(&env, 1, amount_ld, amount_ld);

    let result = setup.oft.try_quote_oft(&setup.owner, &send_param);
    assert_eq!(result.err().unwrap().ok().unwrap(), OFTError::SlippageExceeded.into());
}
