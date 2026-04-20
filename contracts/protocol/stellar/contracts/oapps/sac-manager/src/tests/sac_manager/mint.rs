//! Mint (Mintable) Integration Tests
//!
//! Operator must hold MINTER_ROLE and authorize the call.

use crate::tests::test_helper::{mock_auth, mock_oft_mint_auth, TestSetup};

// =========================================================================
// Mint success — operator with MINTER_ROLE calls mint
// =========================================================================

#[test]
fn test_mint_by_minter() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let recipient = setup.generate_address();

    mock_oft_mint_auth(&setup, &recipient, 1000_i128);
    setup.sac_manager_client.mint(&recipient, &1000, &setup.minter);
    assert_eq!(setup.sac_client.balance(&recipient), 1000);
}

// =========================================================================
// Mint role auth — operator without MINTER_ROLE fails
// =========================================================================

#[test]
fn test_mint_operator_without_role_fails() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let recipient = setup.generate_address();
    let random = setup.generate_address();

    mock_auth(
        &setup.env,
        &setup.sac_manager,
        &random,
        "mint",
        (&recipient, 1000_i128, &random),
    );
    let result = setup.sac_manager_client.try_mint(&recipient, &1000, &random);
    assert!(result.is_err());
}

// =========================================================================
// Mint auth — operator must authorize
// =========================================================================

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_mint_fails_without_minter_auth() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let recipient = setup.generate_address();

    setup.sac_manager_client.mint(&recipient, &1000, &setup.minter);
}
