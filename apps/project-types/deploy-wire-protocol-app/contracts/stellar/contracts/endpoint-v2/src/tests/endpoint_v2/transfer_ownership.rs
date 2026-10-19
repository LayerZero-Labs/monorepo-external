use soroban_sdk::testutils::Address as _;
use utils::ownable::OwnableStorage;

use crate::tests::endpoint_setup::setup;
#[test]
fn test_transfer_ownership() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let new_owner = soroban_sdk::Address::generate(env);

    // Verify initial owner via public interface
    let initial_owner = endpoint_client.owner();
    assert_eq!(initial_owner, Some(context.owner.clone()));

    // Verify initial owner in storage directly
    let initial_owner = env.as_contract(&endpoint_client.address, || OwnableStorage::owner(env));
    assert_eq!(initial_owner, Some(context.owner.clone()), "Initial owner should be in storage");

    context.mock_owner_auth("transfer_ownership", (&new_owner,));
    endpoint_client.transfer_ownership(&new_owner);

    // Verify new owner via public interface
    let owner = endpoint_client.owner();
    assert_eq!(owner, Some(new_owner.clone()));

    // Assert storage change directly
    let stored_owner = env.as_contract(&endpoint_client.address, || OwnableStorage::owner(env));
    assert_eq!(stored_owner, Some(new_owner), "Storage should contain the new owner");
}
