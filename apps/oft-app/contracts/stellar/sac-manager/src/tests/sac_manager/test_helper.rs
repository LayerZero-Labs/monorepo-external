use crate::tests::test_helper::{mock_auth, TestSetup};
use soroban_sdk::Address;

/// Mock auth for `clawback(from, amount, operator)` — operator must hold CLAWBACK_ROLE.
pub fn mock_clawback_auth(setup: &TestSetup, operator: &Address, from: &Address, amount: i128) {
    mock_auth(
        &setup.env,
        &setup.sac_manager,
        operator,
        "clawback",
        (from, amount, operator),
    );
}

/// Mock auth for `set_authorized(id, authorize, operator)` — operator must hold BLACKLISTER_ROLE.
pub fn mock_set_authorized_auth(setup: &TestSetup, operator: &Address, user: &Address, authorize: bool) {
    mock_auth(
        &setup.env,
        &setup.sac_manager,
        operator,
        "set_authorized",
        (user, authorize, operator),
    );
}

/// Mock auth for `set_admin(new_admin, operator)` — operator must hold ADMIN_MANAGER_ROLE.
pub fn mock_set_admin_auth(setup: &TestSetup, operator: &Address, new_admin: &Address) {
    mock_auth(
        &setup.env,
        &setup.sac_manager,
        operator,
        "set_admin",
        (new_admin, operator),
    );
}
