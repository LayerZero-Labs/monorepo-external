use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, IntoVal,
};

use crate::tests::endpoint_setup::setup;
#[test]
fn test_recover_token() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let recipient = Address::generate(env);

    let amount = 1000i128;

    // Mint tokens to the endpoint contract
    context.mint_native(&context.contract_id, amount);

    // Verify initial balances
    assert_eq!(context.native_token_client.balance(&context.contract_id), amount);
    assert_eq!(context.native_token_client.balance(&recipient), 0);

    // Recover tokens with owner auth
    let token_address = context.native_token_client.address.clone();
    env.mock_auths(&[MockAuth {
        address: &context.owner,
        invoke: &MockAuthInvoke {
            contract: &context.contract_id,
            fn_name: "recover_token",
            args: (&token_address, &recipient, amount).into_val(env),
            sub_invokes: &[MockAuthInvoke {
                contract: &token_address,
                fn_name: "transfer",
                args: (&context.contract_id, &recipient, amount).into_val(env),
                sub_invokes: &[],
            }],
        },
    }]);
    endpoint_client.recover_token(&token_address, &recipient, &amount);

    // Verify tokens were transferred
    assert_eq!(context.native_token_client.balance(&context.contract_id), 0);
    assert_eq!(context.native_token_client.balance(&recipient), amount);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_recover_token_fails_for_non_owner() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let non_owner = Address::generate(env);
    let recipient = Address::generate(env);

    let amount = 1000i128;

    // Mint tokens to the endpoint contract
    context.mint_native(&context.contract_id, amount);

    // Try to recover tokens with non-owner auth (should fail)
    let token_address = context.native_token_client.address.clone();
    env.mock_auths(&[MockAuth {
        address: &non_owner,
        invoke: &MockAuthInvoke {
            contract: &context.contract_id,
            fn_name: "recover_token",
            args: (&token_address, &recipient, amount).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint_client.recover_token(&token_address, &recipient, &amount);
}
