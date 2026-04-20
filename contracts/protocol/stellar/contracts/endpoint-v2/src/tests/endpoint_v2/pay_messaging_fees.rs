use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

use crate::{
    tests::endpoint_setup::{setup, TestSetup},
    EndpointV2, FeeRecipient,
};

fn fee_recipients(env: &Env, recipients: &[(&Address, i128)]) -> Vec<FeeRecipient> {
    let mut v = Vec::new(env);
    for (to, amount) in recipients {
        v.push_back(FeeRecipient { to: (*to).clone(), amount: *amount });
    }
    v
}

fn pay_messaging_fees(
    context: &TestSetup,
    pay_in_zro: bool,
    native_fee_recipients: &Vec<FeeRecipient>,
    zro_fee_recipients: &Vec<FeeRecipient>,
    refund_address: &Address,
) -> crate::MessagingFee {
    let env = &context.env;
    let endpoint_addr = &context.endpoint_client.address;
    env.as_contract(endpoint_addr, || {
        EndpointV2::pay_messaging_fees_for_test(env, pay_in_zro, native_fee_recipients, zro_fee_recipients, refund_address)
    })
}

// Native fee distribution (payments + refunds)
#[test]
fn test_pay_native_fees_exact_amount() {
    let context = setup();
    let env = &context.env;
    let recipient = Address::generate(env);
    let refund_address = Address::generate(env);

    // Setup: Mint native tokens to the endpoint contract.
    context.mint_native(&context.endpoint_client.address, 100);

    let native_fee_recipients = fee_recipients(env, &[(&recipient, 100)]);
    let zro_fee_recipients = Vec::new(env);
    let fee = pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.native_token_client.balance(&recipient), 100);
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
}

#[test]
fn test_pay_native_fees_with_refund() {
    let context = setup();
    let env = &context.env;
    let recipient = Address::generate(env);
    let refund_address = Address::generate(env);

    // Setup: Mint more native tokens than needed.
    context.mint_native(&context.endpoint_client.address, 200);

    let native_fee_recipients = fee_recipients(env, &[(&recipient, 100)]);
    let zro_fee_recipients = Vec::new(env);
    let fee = pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.native_token_client.balance(&recipient), 100);
    assert_eq!(context.native_token_client.balance(&refund_address), 100);
}

#[test]
fn test_pay_multiple_recipients_same_token() {
    let context = setup();
    let env = &context.env;
    let recipient1 = Address::generate(env);
    let recipient2 = Address::generate(env);
    let recipient3 = Address::generate(env);
    let refund_address = Address::generate(env);

    // Setup: Mint native tokens.
    context.mint_native(&context.endpoint_client.address, 300);

    let native_fee_recipients = fee_recipients(env, &[(&recipient1, 100), (&recipient2, 150), (&recipient3, 50)]);
    let zro_fee_recipients = Vec::new(env);
    let fee = pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 300);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.native_token_client.balance(&recipient1), 100);
    assert_eq!(context.native_token_client.balance(&recipient2), 150);
    assert_eq!(context.native_token_client.balance(&recipient3), 50);
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
}

#[test]
fn test_pay_fees_with_zero_amounts_skipped() {
    let context = setup();
    let env = &context.env;
    let recipient1 = Address::generate(env);
    let recipient2 = Address::generate(env);
    let refund_address = Address::generate(env);

    // Setup: Mint native tokens.
    context.mint_native(&context.endpoint_client.address, 100);

    let native_fee_recipients = fee_recipients(env, &[(&recipient1, 100), (&recipient2, 0)]); // Zero amount.
    let zro_fee_recipients = Vec::new(env);
    let fee = pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.native_token_client.balance(&recipient1), 100);
    assert_eq!(context.native_token_client.balance(&recipient2), 0);
}

#[test]
fn test_pay_native_fees_all_zero_amounts_refunds_all_native() {
    let context = setup();
    let env = &context.env;
    let recipient1 = Address::generate(env);
    let recipient2 = Address::generate(env);
    let refund_address = Address::generate(env);

    // Setup: Mint native tokens to the endpoint contract.
    context.mint_native(&context.endpoint_client.address, 100);

    // All recipients have amount=0, so no native fees are paid and all native balance is refunded.
    let native_fee_recipients = fee_recipients(env, &[(&recipient1, 0), (&recipient2, 0)]);
    let zro_fee_recipients = Vec::new(env);
    let fee = pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.native_token_client.balance(&recipient1), 0);
    assert_eq!(context.native_token_client.balance(&recipient2), 0);
    assert_eq!(context.native_token_client.balance(&refund_address), 100);
}

#[test]
fn test_pay_fees_with_empty_recipients() {
    let context = setup();
    let env = &context.env;
    let refund_address = Address::generate(env);

    // Setup: Mint tokens.
    context.mint_native(&context.endpoint_client.address, 100);

    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = Vec::new(env);
    let fee = pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.native_token_client.balance(&refund_address), 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // EndpointError::InsufficientNativeFee
fn test_panic_pay_native_fees_insufficient_balance() {
    let context = setup();
    let env = &context.env;
    let recipient = Address::generate(env);
    let refund_address = Address::generate(env);

    // Setup: Mint less native balance than required by the recipients list.
    context.mint_native(&context.endpoint_client.address, 50);

    let native_fee_recipients = fee_recipients(env, &[(&recipient, 100)]);
    let zro_fee_recipients = Vec::new(env);

    pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);
}

// ZRO fee distribution (payments + refunds)
#[test]
fn test_pay_zro_fees_exact_amount() {
    let context = setup();
    let env = &context.env;
    let recipient = Address::generate(env);
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    context.mint_zro(&context.endpoint_client.address, 50);

    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = fee_recipients(env, &[(&recipient, 50)]);
    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 50);
    assert_eq!(context.zro_token_client.balance(&recipient), 50);
    assert_eq!(context.zro_token_client.balance(&refund_address), 0);
}

#[test]
fn test_pay_zro_fees_with_refund() {
    let context = setup();
    let env = &context.env;
    let recipient = Address::generate(env);
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    context.mint_zro(&context.endpoint_client.address, 100);

    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = fee_recipients(env, &[(&recipient, 50)]);
    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 50);
    assert_eq!(context.zro_token_client.balance(&recipient), 50);
    assert_eq!(context.zro_token_client.balance(&refund_address), 50);
}

#[test]
fn test_pay_zro_fees_multiple_recipients_zero_amounts_skipped_and_refunded() {
    let context = setup();
    let env = &context.env;
    let recipient1 = Address::generate(env);
    let recipient2 = Address::generate(env);
    let recipient3 = Address::generate(env);
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    // Mint more ZRO than needed to ensure we exercise the refund path.
    context.mint_zro(&context.endpoint_client.address, 100);

    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = fee_recipients(env, &[(&recipient1, 40), (&recipient2, 0), (&recipient3, 50)]);
    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 90);
    assert_eq!(context.zro_token_client.balance(&recipient1), 40);
    assert_eq!(context.zro_token_client.balance(&recipient2), 0);
    assert_eq!(context.zro_token_client.balance(&recipient3), 50);
    assert_eq!(context.zro_token_client.balance(&refund_address), 10); // 100 - 90
}

// ZRO prerequisites / edge cases
#[test]
#[should_panic(expected = "Error(Contract, #25)")] // EndpointError::ZROUnavailable
fn test_panic_pay_in_zro_without_zro_configured() {
    let context = setup();
    let env = &context.env;
    let refund_address = Address::generate(env);

    // pay_in_zro=true without configuring the ZRO token must panic.
    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = Vec::new(env);
    pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")] // EndpointError::ZeroZROFee
fn test_panic_pay_in_zro_with_zero_zro_balance() {
    let context = setup();
    let env = &context.env;
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    // Note: no ZRO is minted to the endpoint contract, so its ZRO balance is 0.

    let native_fee_recipients = Vec::new(env);
    let recipient = Address::generate(env);
    let zro_fee_recipients = fee_recipients(env, &[(&recipient, 1)]);

    pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);
}

#[test]
fn test_pay_in_zro_with_empty_zro_recipients_refunds_all_zro() {
    let context = setup();
    let env = &context.env;
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    context.mint_zro(&context.endpoint_client.address, 40);

    // No ZRO recipients => no ZRO payments, but remaining ZRO must be refunded.
    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = Vec::new(env);

    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);
    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.zro_token_client.balance(&refund_address), 40);
}

#[test]
fn test_pay_in_zro_with_all_zero_zro_recipients_refunds_all_zro() {
    let context = setup();
    let env = &context.env;
    let recipient1 = Address::generate(env);
    let recipient2 = Address::generate(env);
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    context.mint_zro(&context.endpoint_client.address, 40);

    // A non-empty recipients list with all amount=0 should behave like an empty list:
    // no ZRO is paid, and all ZRO balance is refunded.
    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = fee_recipients(env, &[(&recipient1, 0), (&recipient2, 0)]);
    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 0);
    assert_eq!(context.zro_token_client.balance(&recipient1), 0);
    assert_eq!(context.zro_token_client.balance(&recipient2), 0);
    assert_eq!(context.zro_token_client.balance(&refund_address), 40);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")] // EndpointError::InsufficientZroFee
fn test_panic_pay_zro_fees_insufficient_balance() {
    let context = setup();
    let env = &context.env;
    let recipient = Address::generate(env);
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    context.mint_zro(&context.endpoint_client.address, 25);

    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = fee_recipients(env, &[(&recipient, 50)]);

    pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);
}

// Mixed native + ZRO fee behavior
#[test]
fn test_pay_mixed_native_and_zro_fees() {
    let context = setup();
    let env = &context.env;
    let native_recipient = Address::generate(env);
    let zro_recipient = Address::generate(env);
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    context.mint_native(&context.endpoint_client.address, 100);
    context.mint_zro(&context.endpoint_client.address, 50);

    let native_fee_recipients = fee_recipients(env, &[(&native_recipient, 100)]);
    let zro_fee_recipients = fee_recipients(env, &[(&zro_recipient, 50)]);
    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 50);
    assert_eq!(context.native_token_client.balance(&native_recipient), 100);
    assert_eq!(context.zro_token_client.balance(&zro_recipient), 50);
    assert_eq!(context.native_token_client.balance(&refund_address), 0);
    assert_eq!(context.zro_token_client.balance(&refund_address), 0);
}

#[test]
fn test_pay_fees_with_mixed_zero_and_nonzero_amounts() {
    let context = setup();
    let env = &context.env;
    let recipient1 = Address::generate(env);
    let recipient2 = Address::generate(env);
    let recipient3 = Address::generate(env);
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();
    context.mint_native(&context.endpoint_client.address, 150);
    context.mint_zro(&context.endpoint_client.address, 75);

    let native_fee_recipients = fee_recipients(env, &[(&recipient1, 100)]);
    let zro_fee_recipients = fee_recipients(env, &[(&recipient2, 0), (&recipient3, 50)]); // Zero ZRO.
    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);

    assert_eq!(fee.native_fee, 100);
    assert_eq!(fee.zro_fee, 50);
    assert_eq!(context.native_token_client.balance(&recipient1), 100);
    assert_eq!(context.zro_token_client.balance(&recipient2), 0);
    assert_eq!(context.zro_token_client.balance(&recipient3), 50);
    assert_eq!(context.native_token_client.balance(&refund_address), 50);
    assert_eq!(context.zro_token_client.balance(&refund_address), 25);
}

#[test]
fn test_pay_in_zro_still_refunds_native_balance() {
    let context = setup();
    let env = &context.env;
    let refund_address = Address::generate(env);

    context.setup_zro_with_auth();

    // Mint native to the endpoint but provide no native recipients => all native is refunded.
    context.mint_native(&context.endpoint_client.address, 100);

    // Also pay a ZRO fee to ensure the ZRO path executes normally.
    context.mint_zro(&context.endpoint_client.address, 50);
    let zro_recipient = Address::generate(env);

    let native_fee_recipients = Vec::new(env);
    let zro_fee_recipients = fee_recipients(env, &[(&zro_recipient, 50)]);

    let fee = pay_messaging_fees(&context, true, &native_fee_recipients, &zro_fee_recipients, &refund_address);
    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 50);

    // Native refund happens even when pay_in_zro=true.
    assert_eq!(context.native_token_client.balance(&refund_address), 100);
    assert_eq!(context.zro_token_client.balance(&refund_address), 0);
}

// The pay_in_zro flag behavior
#[test]
fn test_pay_in_native_does_not_touch_zro_even_if_provided() {
    let context = setup();
    let env = &context.env;
    let refund_address = Address::generate(env);

    // Mint ZRO to endpoint, but pay_in_zro=false should ignore ZRO recipients/balances entirely.
    context.mint_zro(&context.endpoint_client.address, 30);

    let native_fee_recipients = Vec::new(env);
    let zro_recipient = Address::generate(env);
    let zro_fee_recipients = fee_recipients(env, &[(&zro_recipient, 10)]);

    let fee = pay_messaging_fees(&context, false, &native_fee_recipients, &zro_fee_recipients, &refund_address);
    assert_eq!(fee.native_fee, 0);
    assert_eq!(fee.zro_fee, 0);

    // No ZRO payments or refunds when pay_in_zro=false.
    assert_eq!(context.zro_token_client.balance(&zro_recipient), 0);
    assert_eq!(context.zro_token_client.balance(&refund_address), 0);
    assert_eq!(context.zro_token_client.balance(&context.endpoint_client.address), 30);
}
