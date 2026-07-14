//! Clawback Integration Tests
//!
//! Operator must hold CLAWBACK_ROLE. SAC must have AUTH_CLAWBACK_ENABLED.

use super::test_helper::mock_clawback_auth;
use crate::tests::test_helper::{mock_oft_mint_auth, TestSetup};
use soroban_sdk::testutils::IssuerFlags;

// =========================================================================
// clawback Tests
// =========================================================================

#[test]
fn test_clawback_by_owner() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let user = setup.generate_address();

    setup.sac_contract.issuer().set_flag(IssuerFlags::RevocableFlag);
    setup.sac_contract.issuer().set_flag(IssuerFlags::ClawbackEnabledFlag);

    mock_oft_mint_auth(&setup, &user, 1000_i128);
    setup.sac_manager_client.mint(&user, &1000, &setup.minter);
    assert_eq!(setup.sac_client.balance(&user), 1000);

    mock_clawback_auth(&setup, &setup.owner, &user, 500_i128);
    setup.sac_manager_client.clawback(&user, &500, &setup.owner);
    assert_eq!(setup.sac_client.balance(&user), 500);
}

#[test]
fn test_clawback_full_balance() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let user = setup.generate_address();

    setup.sac_contract.issuer().set_flag(IssuerFlags::RevocableFlag);
    setup.sac_contract.issuer().set_flag(IssuerFlags::ClawbackEnabledFlag);

    mock_oft_mint_auth(&setup, &user, 1000_i128);
    setup.sac_manager_client.mint(&user, &1000, &setup.minter);

    mock_clawback_auth(&setup, &setup.owner, &user, 1000_i128);
    setup.sac_manager_client.clawback(&user, &1000, &setup.owner);
    assert_eq!(setup.sac_client.balance(&user), 0);
}

#[test]
fn test_clawback_fails_when_amount_exceeds_balance() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let user = setup.generate_address();

    setup.sac_contract.issuer().set_flag(IssuerFlags::RevocableFlag);
    setup.sac_contract.issuer().set_flag(IssuerFlags::ClawbackEnabledFlag);

    mock_oft_mint_auth(&setup, &user, 100_i128);
    setup.sac_manager_client.mint(&user, &100, &setup.minter);

    mock_clawback_auth(&setup, &setup.owner, &user, 200_i128);
    let result = setup.sac_manager_client.try_clawback(&user, &200, &setup.owner);
    assert!(result.is_err());
}

#[test]
fn test_clawback_operator_without_role_fails() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let user = setup.generate_address();
    let random = setup.generate_address();

    mock_clawback_auth(&setup, &random, &user, 500_i128);
    let result = setup.sac_manager_client.try_clawback(&user, &500, &random);
    assert!(result.is_err());
}

// =========================================================================
// clawback Auth Tests
// =========================================================================

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clawback_fails_without_auth() {
    let setup = TestSetup::new().build();
    let user = setup.generate_address();

    setup.sac_manager_client.clawback(&user, &300, &setup.owner);
}
