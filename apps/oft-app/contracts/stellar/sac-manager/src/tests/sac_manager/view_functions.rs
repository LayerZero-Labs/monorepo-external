//! View Functions Integration Tests

use crate::tests::test_helper::TestSetup;

// =========================================================================
// Core View Functions
// =========================================================================

#[test]
fn test_underlying_sac() {
    let setup = TestSetup::new().build();
    assert_eq!(setup.sac_manager_client.underlying_sac(), setup.sac);
}
