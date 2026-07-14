use crate::{
    tests::test_utils::{create_recipient_address, generate_g_address},
    utils::{address_payload, resolve_address},
};
use soroban_sdk::Env;

#[test]
fn test_resolve_address_contract_exists() {
    let env = Env::default();

    // Create a contract address
    let contract_address = create_recipient_address(&env);

    // Convert to bytes32
    let bytes32 = address_payload(&env, &contract_address);

    // Resolve back - should return the same contract address
    let resolved = resolve_address(&env, &bytes32);

    assert_eq!(resolved, contract_address);
}

#[test]
fn test_resolve_address_contract_not_exists_fallback_to_g_address() {
    let env = Env::default();

    // Create a G-address (account address)
    let g_address = generate_g_address(&env);

    // Convert to bytes32
    let bytes32 = address_payload(&env, &g_address);

    // Resolve - should fallback to G-address since contract doesn't exist
    let resolved = resolve_address(&env, &bytes32);

    assert_eq!(resolved, g_address);
}
