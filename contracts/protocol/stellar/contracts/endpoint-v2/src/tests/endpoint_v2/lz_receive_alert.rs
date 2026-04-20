use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};
use utils::testing_utils::assert_eq_event;

use crate::{
    endpoint_v2::EndpointV2Client, events::LzReceiveAlert, tests::endpoint_setup::setup,
    tests::endpoint_setup::TestSetup, Origin,
};

// Helpers
struct LzReceiveAlertFixture {
    executor: Address,
    receiver: Address,
    origin: Origin,
    guid: BytesN<32>,
    gas: i128,
    value: i128,
    message: Bytes,
    extra_data: Bytes,
    reason: Bytes,
}

fn default_fixture(env: &Env) -> LzReceiveAlertFixture {
    let executor = soroban_sdk::Address::generate(env);
    let receiver = soroban_sdk::Address::generate(env);

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let origin = Origin { src_eid, sender, nonce };

    LzReceiveAlertFixture {
        executor,
        receiver,
        origin,
        guid: BytesN::from_array(env, &[5u8; 32]),
        gas: 1000i128,
        value: 100i128,
        message: Bytes::from_array(env, &[1, 2, 3, 4]),
        extra_data: Bytes::from_array(env, &[5, 6]),
        reason: Bytes::from_array(env, &[7, 8, 9]),
    }
}

fn invoke_lz_receive_alert_with_auth<'a>(
    context: &TestSetup,
    endpoint_client: &EndpointV2Client<'a>,
    executor: &Address,
    origin: &Origin,
    receiver: &Address,
    guid: &BytesN<32>,
    gas: i128,
    value: i128,
    message: &Bytes,
    extra_data: &Bytes,
    reason: &Bytes,
) {
    // The endpoint requires authorization from `executor`.
    context.mock_auth(
        executor,
        "lz_receive_alert",
        (executor, origin, receiver, guid, &gas, &value, message, extra_data, reason),
    );

    endpoint_client.lz_receive_alert(executor, origin, receiver, guid, &gas, &value, message, extra_data, reason);
}

// Authorization (executor must authorize)
#[test]
fn test_lz_receive_alert_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let f = default_fixture(env);

    invoke_lz_receive_alert_with_auth(
        &context,
        endpoint_client,
        &f.executor,
        &f.origin,
        &f.receiver,
        &f.guid,
        f.gas,
        f.value,
        &f.message,
        &f.extra_data,
        &f.reason,
    );

    assert_eq_event(
        env,
        &endpoint_client.address,
        LzReceiveAlert {
            receiver: f.receiver.clone(),
            executor: f.executor.clone(),
            origin: f.origin.clone(),
            guid: f.guid.clone(),
            gas: f.gas,
            value: f.value,
            message: f.message.clone(),
            extra_data: f.extra_data.clone(),
            reason: f.reason.clone(),
        },
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_lz_receive_alert_fails_without_executor_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let f = default_fixture(env);

    // Calling without `env.mock_auths(...)` should fail because `executor.require_auth()` is enforced.
    endpoint_client.lz_receive_alert(
        &f.executor,
        &f.origin,
        &f.receiver,
        &f.guid,
        &f.gas,
        &f.value,
        &f.message,
        &f.extra_data,
        &f.reason,
    );
}

// Payload edge cases
#[test]
fn test_lz_receive_alert_with_empty_data() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let mut f = default_fixture(env);
    f.gas = 0;
    f.value = 0;
    f.message = Bytes::new(env);
    f.extra_data = Bytes::new(env);
    f.reason = Bytes::new(env);

    invoke_lz_receive_alert_with_auth(
        &context,
        endpoint_client,
        &f.executor,
        &f.origin,
        &f.receiver,
        &f.guid,
        f.gas,
        f.value,
        &f.message,
        &f.extra_data,
        &f.reason,
    );

    assert_eq_event(
        env,
        &endpoint_client.address,
        LzReceiveAlert {
            receiver: f.receiver.clone(),
            executor: f.executor.clone(),
            origin: f.origin.clone(),
            guid: f.guid.clone(),
            gas: f.gas,
            value: f.value,
            message: f.message.clone(),
            extra_data: f.extra_data.clone(),
            reason: f.reason.clone(),
        },
    );
}
