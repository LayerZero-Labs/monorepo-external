use soroban_sdk::Env;

use super::test_utils::OFTTestSetup;

#[test]
fn test_oft_version_returns_correct_values() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    let (major, minor) = setup.oft.oft_version();
    assert_eq!(major, 1);
    assert_eq!(minor, 1);
}

#[test]
fn test_approval_required_returns_false_by_default() {
    let env = Env::default();
    let setup = OFTTestSetup::new(&env);

    // Default OFTCore behavior: no separate token approval is required.
    assert!(!setup.oft.approval_required());
}
