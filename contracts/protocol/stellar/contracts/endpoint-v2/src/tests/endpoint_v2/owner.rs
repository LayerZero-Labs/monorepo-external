use crate::tests::endpoint_setup::setup;
#[test]
fn test_owner() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    let owner = endpoint_client.owner();
    assert_eq!(owner, Some(context.owner));
}
