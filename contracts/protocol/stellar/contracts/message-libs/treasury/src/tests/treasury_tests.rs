extern crate std;

use soroban_sdk::testutils::{Address as _, Events as _};

use crate::{
    errors::TreasuryError,
    tests::setup::{setup, BPS_DENOMINATOR},
};

// ============================================================================
// Initialization Tests
// ============================================================================

#[test]
fn test_treasury_initialization() {
    let setup = setup();

    // Verify initial state matches defaults
    assert_eq!(setup.treasury.native_fee_bp(), 0);
    assert!(!setup.treasury.fee_enabled());
    assert!(setup.treasury.zro_fee_lib().is_none());
}

// ============================================================================
// Core Fee Logic Tests
// ============================================================================

#[test]
fn test_get_fee_disabled_by_default() {
    let setup = setup();

    let sender = soroban_sdk::Address::generate(&setup.env);
    let dst_eid = 101_u32;

    // When fee_enabled = false, should return 0 regardless of other settings
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &1000, &false);
    assert_eq!(fee, 0);
}

#[test]
fn test_get_fee_native_payment_enabled() {
    let setup = setup();

    let sender = soroban_sdk::Address::generate(&setup.env);
    let dst_eid = 101_u32;

    // Configure treasury with 5% native fee (500 BPS)
    setup.configure_treasury(500);

    // Test various amounts
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &1000, &false);
    assert_eq!(fee, 50); // 1000 * 500 / 10000 = 50

    let fee = setup.treasury.get_fee(&sender, &dst_eid, &10000, &false);
    assert_eq!(fee, 500); // 10000 * 500 / 10000 = 500

    let fee = setup.treasury.get_fee(&sender, &dst_eid, &0, &false);
    assert_eq!(fee, 0); // 0 * 500 / 10000 = 0
}

#[test]
fn test_get_fee_zro_payment_requires_fee_lib() {
    let setup = setup();

    let sender = soroban_sdk::Address::generate(&setup.env);
    let dst_eid = 101_u32;

    // Configure treasury without ZRO fee lib
    setup.configure_treasury(500);

    // Should fail when trying to pay in ZRO without fee lib set
    let result = setup.treasury.try_get_fee(&sender, &dst_eid, &1000, &true);
    assert_eq!(result.err().unwrap().ok().unwrap(), TreasuryError::ZroFeeLibNotSet.into());
}

// ============================================================================
// Admin Configuration Tests
// ============================================================================

#[test]
fn test_set_fee_enabled() {
    let setup = setup();

    // Initially disabled
    assert!(!setup.treasury.fee_enabled());

    // Enable fees
    setup.mock_owner_auth("set_fee_enabled", (&true,));
    setup.treasury.set_fee_enabled(&true);
    assert!(setup.treasury.fee_enabled());

    // Disable fees again
    setup.mock_owner_auth("set_fee_enabled", (&false,));
    setup.treasury.set_fee_enabled(&false);
    assert!(!setup.treasury.fee_enabled());
}

#[test]
fn test_set_native_fee_bp() {
    let setup = setup();

    // Test valid BPS values
    setup.mock_owner_auth("set_native_fee_bp", (&0_u32,));
    setup.treasury.set_native_fee_bp(&0);
    assert_eq!(setup.treasury.native_fee_bp(), 0);

    setup.mock_owner_auth("set_native_fee_bp", (&500_u32,));
    setup.treasury.set_native_fee_bp(&500); // 5%
    assert_eq!(setup.treasury.native_fee_bp(), 500);

    setup.mock_owner_auth("set_native_fee_bp", (&10000_u32,));
    setup.treasury.set_native_fee_bp(&10000); // 100%
    assert_eq!(setup.treasury.native_fee_bp(), 10000);
}

#[test]
fn test_set_native_fee_bp_invalid() {
    let setup = setup();

    // Should fail with BPS > 10000
    setup.mock_owner_auth("set_native_fee_bp", (&10001_u32,));
    let result = setup.treasury.try_set_native_fee_bp(&10001);
    assert_eq!(result.err().unwrap().ok().unwrap(), TreasuryError::InvalidNativeFeeBp.into());
}

#[test]
fn test_set_zro_fee_lib() {
    let setup = setup();

    // Use contract address since it needs to pass .exists() check
    let fee_lib = setup.create_contract_address();

    // Initially no fee lib
    assert!(setup.treasury.zro_fee_lib().is_none());

    // Set fee lib
    setup.mock_owner_auth("set_zro_fee_lib", (&Some(fee_lib.clone()),));
    setup.treasury.set_zro_fee_lib(&Some(fee_lib.clone()));
    assert_eq!(setup.treasury.zro_fee_lib(), Some(fee_lib));

    // Remove fee lib
    let none_val: Option<soroban_sdk::Address> = None;
    setup.mock_owner_auth("set_zro_fee_lib", (&none_val,));
    setup.treasury.set_zro_fee_lib(&none_val);
    assert!(setup.treasury.zro_fee_lib().is_none());
}

// ============================================================================
// Edge Cases & Boundary Tests
// ============================================================================

#[test]
fn test_fee_calculation_edge_cases() {
    let setup = setup();

    let sender = soroban_sdk::Address::generate(&setup.env);
    let dst_eid = 101_u32;

    setup.configure_treasury(0);

    // Test 0% fee (0 BPS)
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &1000, &false);
    assert_eq!(fee, 0);

    // Test 100% fee (10000 BPS)
    setup.mock_owner_auth("set_native_fee_bp", (&10000_u32,));
    setup.treasury.set_native_fee_bp(&10000);
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &1000, &false);
    assert_eq!(fee, 1000); // 1000 * 10000 / 10000 = 1000

    // Test maximum total fee with minimal BPS
    let max_safe_input: i128 = i128::MAX / BPS_DENOMINATOR as i128; // Avoid overflow
    setup.mock_owner_auth("set_native_fee_bp", (&1_u32,));
    setup.treasury.set_native_fee_bp(&1); // 0.01%
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &max_safe_input, &false);
    assert_eq!(fee, max_safe_input / BPS_DENOMINATOR as i128);
}

#[test]
fn test_precision_and_rounding() {
    let setup = setup();

    let sender = soroban_sdk::Address::generate(&setup.env);
    let dst_eid = 101_u32;

    setup.configure_treasury(1); // 0.01%

    // Test rounding behavior (integer division truncates)
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &9999, &false);
    assert_eq!(fee, 0); // 9999 * 1 / 10000 = 0 (rounded down)

    let fee = setup.treasury.get_fee(&sender, &dst_eid, &10000, &false);
    assert_eq!(fee, 1); // 10000 * 1 / 10000 = 1

    let fee = setup.treasury.get_fee(&sender, &dst_eid, &20000, &false);
    assert_eq!(fee, 2); // 20000 * 1 / 10000 = 2
}

#[test]
fn test_get_fee_rejects_negative_total_native_fee() {
    let setup = setup();

    let sender = soroban_sdk::Address::generate(&setup.env);
    let dst_eid = 101_u32;

    setup.configure_treasury(500);

    let result = setup.treasury.try_get_fee(&sender, &dst_eid, &(-1_i128), &false);
    assert_eq!(result.err().unwrap().ok().unwrap(), TreasuryError::InvalidTotalNativeFee.into());
}

// ============================================================================
// Withdraw Token Tests
// ============================================================================

#[test]
fn test_withdraw_token_valid() {
    let setup = setup();

    // Create recipient address (must exist)
    let recipient = setup.create_contract_address();

    // Deploy a test token
    let token = setup.deploy_test_token();

    // Mint tokens to the treasury contract
    let withdraw_amount = 1000_i128;
    setup.mint_tokens(&token, &setup.treasury.address, withdraw_amount);

    // Verify initial balance
    let initial_balance = setup.get_token_balance(&token, &setup.treasury.address);
    assert_eq!(initial_balance, withdraw_amount);

    // Withdraw tokens as owner
    setup.mock_owner_auth("withdraw_token", (&token, &recipient, &withdraw_amount));
    setup.treasury.withdraw_token(&token, &recipient, &withdraw_amount);

    // Verify balances after withdrawal
    let treasury_balance = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient_balance = setup.get_token_balance(&token, &recipient);
    assert_eq!(treasury_balance, 0);
    assert_eq!(recipient_balance, withdraw_amount);
}

#[test]
fn test_withdraw_token_partial_amount() {
    let setup = setup();

    let recipient = setup.create_contract_address();
    let token = setup.deploy_test_token();

    let initial_amount = 10000_i128;
    let withdraw_amount = 3000_i128;

    setup.mint_tokens(&token, &setup.treasury.address, initial_amount);

    setup.mock_owner_auth("withdraw_token", (&token, &recipient, &withdraw_amount));
    setup.treasury.withdraw_token(&token, &recipient, &withdraw_amount);

    // Verify partial withdrawal
    let treasury_balance = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient_balance = setup.get_token_balance(&token, &recipient);
    assert_eq!(treasury_balance, initial_amount - withdraw_amount);
    assert_eq!(recipient_balance, withdraw_amount);
}

#[test]
fn test_withdraw_token_invalid_amount_zero() {
    let setup = setup();

    let recipient = setup.create_contract_address();
    let token = setup.deploy_test_token();

    setup.mint_tokens(&token, &setup.treasury.address, 1000);

    // With current implementation, withdrawing 0 is allowed (token contract permits it).
    let treasury_balance_before = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient_balance_before = setup.get_token_balance(&token, &recipient);

    setup.mock_owner_auth("withdraw_token", (&token, &recipient, &0_i128));
    let result = setup.treasury.try_withdraw_token(&token, &recipient, &0);
    assert!(result.is_ok());

    let treasury_balance_after = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient_balance_after = setup.get_token_balance(&token, &recipient);
    assert_eq!(treasury_balance_after, treasury_balance_before);
    assert_eq!(recipient_balance_after, recipient_balance_before);
}

#[test]
fn test_withdraw_token_invalid_amount_negative() {
    let setup = setup();

    let recipient = setup.create_contract_address();
    let token = setup.deploy_test_token();

    setup.mint_tokens(&token, &setup.treasury.address, 1000);

    // Try to withdraw negative amount
    setup.mock_owner_auth("withdraw_token", (&token, &recipient, &(-100_i128)));
    let result = setup.treasury.try_withdraw_token(&token, &recipient, &-100);
    assert!(result.is_err());
}

#[test]
fn test_withdraw_token_invalid_recipient() {
    let setup = setup();

    // Generate an address that doesn't exist as a contract (won't pass `.exists()`),
    // but token transfers to such addresses are still allowed.
    let non_existent_recipient = soroban_sdk::Address::generate(&setup.env);
    let token = setup.deploy_test_token();

    setup.mint_tokens(&token, &setup.treasury.address, 1000);

    let treasury_balance_before = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient_balance_before = setup.get_token_balance(&token, &non_existent_recipient);

    // Withdraw to a non-contract address (should succeed)
    setup.mock_owner_auth("withdraw_token", (&token, &non_existent_recipient, &500_i128));
    let result = setup.treasury.try_withdraw_token(&token, &non_existent_recipient, &500);
    assert!(result.is_ok());

    let treasury_balance_after = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient_balance_after = setup.get_token_balance(&token, &non_existent_recipient);
    assert_eq!(treasury_balance_after, treasury_balance_before - 500);
    assert_eq!(recipient_balance_after, recipient_balance_before + 500);
}

#[test]
fn test_withdraw_token_insufficient_balance() {
    let setup = setup();

    let recipient = setup.create_contract_address();
    let token = setup.deploy_test_token();

    let balance = 500_i128;
    let withdraw_amount = 1000_i128;

    setup.mint_tokens(&token, &setup.treasury.address, balance);

    // Try to withdraw more than balance
    setup.mock_owner_auth("withdraw_token", (&token, &recipient, &withdraw_amount));
    let result = setup.treasury.try_withdraw_token(&token, &recipient, &withdraw_amount);
    assert!(result.is_err());
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_withdraw_token_not_owner() {
    let setup = setup();

    let non_owner = soroban_sdk::Address::generate(&setup.env);
    let recipient = setup.create_contract_address();
    let token = setup.deploy_test_token();

    setup.mint_tokens(&token, &setup.treasury.address, 1000);

    // Try to withdraw as non-owner
    setup.mock_auth(&non_owner, "withdraw_token", (&token, &recipient, &500_i128));
    setup.treasury.withdraw_token(&token, &recipient, &500);
}

#[test]
fn test_withdraw_token_entire_balance() {
    let setup = setup();

    let recipient = setup.create_contract_address();
    let token = setup.deploy_test_token();

    let total_balance = 5000_i128;
    setup.mint_tokens(&token, &setup.treasury.address, total_balance);

    // Withdraw entire balance
    setup.mock_owner_auth("withdraw_token", (&token, &recipient, &total_balance));
    setup.treasury.withdraw_token(&token, &recipient, &total_balance);

    // Verify complete withdrawal
    let treasury_balance = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient_balance = setup.get_token_balance(&token, &recipient);
    assert_eq!(treasury_balance, 0);
    assert_eq!(recipient_balance, total_balance);
}

#[test]
fn test_withdraw_token_multiple_withdrawals() {
    let setup = setup();

    let recipient1 = setup.create_contract_address();
    let recipient2 = setup.create_contract_address();
    let token = setup.deploy_test_token();

    let initial_balance = 10000_i128;
    let first_withdrawal = 3000_i128;
    let second_withdrawal = 2000_i128;

    setup.mint_tokens(&token, &setup.treasury.address, initial_balance);

    // First withdrawal
    setup.mock_owner_auth("withdraw_token", (&token, &recipient1, &first_withdrawal));
    setup.treasury.withdraw_token(&token, &recipient1, &first_withdrawal);

    // Second withdrawal to different recipient
    setup.mock_owner_auth("withdraw_token", (&token, &recipient2, &second_withdrawal));
    setup.treasury.withdraw_token(&token, &recipient2, &second_withdrawal);

    // Verify all balances
    let treasury_balance = setup.get_token_balance(&token, &setup.treasury.address);
    let recipient1_balance = setup.get_token_balance(&token, &recipient1);
    let recipient2_balance = setup.get_token_balance(&token, &recipient2);

    assert_eq!(treasury_balance, initial_balance - first_withdrawal - second_withdrawal);
    assert_eq!(recipient1_balance, first_withdrawal);
    assert_eq!(recipient2_balance, second_withdrawal);
}

#[test]
fn test_withdraw_token_multiple_tokens() {
    let setup = setup();

    let recipient = setup.create_contract_address();
    let token1 = setup.deploy_test_token();
    let token2 = setup.deploy_test_token();

    let amount1 = 1000_i128;
    let amount2 = 2000_i128;

    // Setup balances for two different tokens
    setup.mint_tokens(&token1, &setup.treasury.address, amount1);
    setup.mint_tokens(&token2, &setup.treasury.address, amount2);

    // Withdraw from first token
    setup.mock_owner_auth("withdraw_token", (&token1, &recipient, &amount1));
    setup.treasury.withdraw_token(&token1, &recipient, &amount1);

    // Withdraw from second token
    setup.mock_owner_auth("withdraw_token", (&token2, &recipient, &amount2));
    setup.treasury.withdraw_token(&token2, &recipient, &amount2);

    // Verify balances for both tokens
    assert_eq!(setup.get_token_balance(&token1, &setup.treasury.address), 0);
    assert_eq!(setup.get_token_balance(&token2, &setup.treasury.address), 0);
    assert_eq!(setup.get_token_balance(&token1, &recipient), amount1);
    assert_eq!(setup.get_token_balance(&token2, &recipient), amount2);
}

#[test]
fn test_withdraw_token_events_emitted() {
    let setup = setup();

    let recipient = setup.create_contract_address();
    let token = setup.deploy_test_token();
    let amount = 500_i128;

    setup.mint_tokens(&token, &setup.treasury.address, amount);

    // Count events before withdrawal
    let events_before = setup.env.events().all().events().len();

    // Withdraw tokens and check that events are emitted
    setup.mock_owner_auth("withdraw_token", (&token, &recipient, &amount));
    setup.treasury.withdraw_token(&token, &recipient, &amount);

    // Verify that new events were published
    let events_after = setup.env.events().all().events().len();
    assert!(events_after > events_before, "TokenWithdrawn event should be emitted");
}

// ============================================================================
// Integration Tests
// ============================================================================

#[test]
fn test_complete_workflow() {
    let setup = setup();

    let sender = soroban_sdk::Address::generate(&setup.env);
    let dst_eid = 101_u32;

    // === STEP 1: Initial Configuration ===
    setup.configure_treasury(250);

    // === STEP 2: Test Native Fee Calculation ===
    let total_worker_fee: i128 = 10000;
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &total_worker_fee, &false);
    assert_eq!(fee, 250); // 10000 * 250 / 10000 = 250

    // === STEP 3: Test Fee Disable ===
    setup.mock_owner_auth("set_fee_enabled", (&false,));
    setup.treasury.set_fee_enabled(&false);
    let fee = setup.treasury.get_fee(&sender, &dst_eid, &total_worker_fee, &false);
    assert_eq!(fee, 0); // Should return 0 when disabled
}

// ============================================================================
// View Function Tests
// ============================================================================

#[test]
fn test_view_functions_consistency() {
    let setup = setup();

    let native_fee_bp: u32 = 750; // 7.5%

    setup.configure_treasury(native_fee_bp);

    // Verify all view functions return correct values
    assert_eq!(setup.treasury.native_fee_bp(), native_fee_bp);
    assert!(setup.treasury.fee_enabled());
}

// ============================================================================
// Authorization Tests
// ============================================================================

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_set_native_fee_bp_not_owner() {
    let setup = setup();

    let non_owner = soroban_sdk::Address::generate(&setup.env);

    setup.mock_auth(&non_owner, "set_native_fee_bp", (&500_u32,));
    setup.treasury.set_native_fee_bp(&500);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_set_fee_enabled_not_owner() {
    let setup = setup();

    let non_owner = soroban_sdk::Address::generate(&setup.env);

    setup.mock_auth(&non_owner, "set_fee_enabled", (&true,));
    setup.treasury.set_fee_enabled(&true);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_set_zro_fee_lib_not_owner() {
    let setup = setup();

    let non_owner = soroban_sdk::Address::generate(&setup.env);
    // Use contract address since it needs to pass .exists() check
    let fee_lib = setup.create_contract_address();

    setup.mock_auth(&non_owner, "set_zro_fee_lib", (&Some(fee_lib.clone()),));
    setup.treasury.set_zro_fee_lib(&Some(fee_lib));
}
