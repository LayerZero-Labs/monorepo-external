use soroban_sdk::Env;

use super::test_utils::OFTTestSetup;

#[test]
fn test_token_returns_correct_address() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let returned_token = setup.oft.token();
    assert_eq!(returned_token, setup.token);
}

#[test]
fn test_token_with_stellar_asset_contract() {
    let env = Env::default();
    // OFTTestSetup already uses Stellar Asset Contract
    let setup = OFTTestSetup::new(&env);

    let returned_token = setup.oft.token();
    assert_eq!(returned_token, setup.token);
}

#[test]
fn test_token_address_persists() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Call token() multiple times to ensure consistency
    let token1 = setup.oft.token();
    let token2 = setup.oft.token();
    let token3 = setup.oft.token();

    assert_eq!(token1, setup.token);
    assert_eq!(token2, setup.token);
    assert_eq!(token3, setup.token);
}

#[test]
fn test_oft_version_returns_correct_values() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let (major, minor) = setup.oft.oft_version();
    assert_eq!(major, 1);
    assert_eq!(minor, 1);
}
