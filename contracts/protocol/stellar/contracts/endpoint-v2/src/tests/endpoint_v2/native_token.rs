use crate::tests::endpoint_setup::setup;
#[test]
fn test_native_token() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;

    let native_token = endpoint_client.native_token();
    assert_eq!(native_token, context.native_token_client.address);
}
