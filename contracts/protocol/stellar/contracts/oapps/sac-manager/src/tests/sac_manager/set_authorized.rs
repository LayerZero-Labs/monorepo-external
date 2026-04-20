//! set_authorized Integration Tests
//!
//! Requires revocable issuer flag on the SAC. Operator must hold BLACKLISTER_ROLE.

use super::test_helper::mock_set_authorized_auth;
use crate::tests::test_helper::TestSetup;
use soroban_sdk::testutils::IssuerFlags;

// =========================================================================
// set_authorized Tests
// =========================================================================

#[test]
fn test_set_authorized_by_owner() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let user = setup.generate_address();

    setup.sac_contract.issuer().set_flag(IssuerFlags::RevocableFlag);
    assert!(setup.sac_client.authorized(&user));

    mock_set_authorized_auth(&setup, &setup.owner, &user, false);
    setup.sac_manager_client.set_authorized(&user, &false, &setup.owner);
    assert!(!setup.sac_client.authorized(&user));

    mock_set_authorized_auth(&setup, &setup.owner, &user, true);
    setup.sac_manager_client.set_authorized(&user, &true, &setup.owner);
    assert!(setup.sac_client.authorized(&user));
}

// =========================================================================
// set_authorized Role Auth Tests
// =========================================================================

#[test]
fn test_set_authorized_operator_without_role_fails() {
    let setup = TestSetup::new().with_manager_as_sac_admin().build();
    let user = setup.generate_address();
    let random = setup.generate_address();

    setup.sac_contract.issuer().set_flag(IssuerFlags::RevocableFlag);
    mock_set_authorized_auth(&setup, &random, &user, false);
    let result = setup.sac_manager_client.try_set_authorized(&user, &false, &random);
    assert!(result.is_err());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_authorized_without_auth() {
    let setup = TestSetup::new().build();
    let user = setup.generate_address();

    setup.sac_manager_client.set_authorized(&user, &false, &setup.owner);
}
