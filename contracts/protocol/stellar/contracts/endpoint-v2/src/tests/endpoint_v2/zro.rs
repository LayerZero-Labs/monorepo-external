use crate::tests::endpoint_setup::setup;
#[test]
fn test_zro_when_not_set() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    let zro_token = endpoint_client.zro();
    assert_eq!(zro_token, None);
}

#[test]
fn test_zro_after_set() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    // Set ZRO token
    context.mock_owner_auth("set_zro", (&context.zro_token_client.address,));
    endpoint_client.set_zro(&context.zro_token_client.address);

    let zro_token = endpoint_client.zro();
    assert_eq!(zro_token, Some(context.zro_token_client.address));
}
