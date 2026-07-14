//! set_admin Integration Tests
//!
//! Tests that set_admin requires ADMIN_MANAGER_ROLE on the operator.

use super::test_helper::mock_set_admin_auth;
use crate::tests::test_helper::TestSetup;

// =========================================================================
// set_admin Tests
// =========================================================================

#[test]
fn test_set_admin_by_owner() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let new_admin = setup.generate_address();

    assert_eq!(setup.sac_client.admin(), setup.sac_manager);

    mock_set_admin_auth(&setup, &setup.owner, &new_admin);
    setup.sac_manager_client.set_admin(&new_admin, &setup.owner);
    assert_eq!(setup.sac_client.admin(), new_admin);
}

// =========================================================================
// set_admin Role Auth Tests
// =========================================================================

#[test]
fn test_set_admin_operator_without_role_fails() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let new_admin = setup.generate_address();
    let random = setup.generate_address();

    mock_set_admin_auth(&setup, &random, &new_admin);
    let result = setup.sac_manager_client.try_set_admin(&new_admin, &random);
    assert!(result.is_err());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_admin_without_auth() {
    let setup = TestSetup::new().build();
    let new_admin = setup.generate_address();

    setup.sac_manager_client.set_admin(&new_admin, &setup.owner);
}
