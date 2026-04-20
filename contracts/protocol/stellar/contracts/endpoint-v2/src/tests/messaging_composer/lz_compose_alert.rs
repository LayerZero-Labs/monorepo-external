use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};
use utils::testing_utils::assert_eq_event;

use crate::{
    endpoint_v2::EndpointV2Client,
    errors::EndpointError,
    events::LzComposeAlert,
    tests::{
        endpoint_setup::{setup, TestSetup},
        messaging_composer::MAX_COMPOSE_INDEX,
    },
};

// Helpers
struct LzComposeAlertFixture {
    executor: Address,
    from: Address,
    to: Address,
    guid: BytesN<32>,
    index: u32,
    gas: i128,
    value: i128,
    message: Bytes,
    extra_data: Bytes,
    reason: Bytes,
}

fn default_fixture(env: &Env) -> LzComposeAlertFixture {
    LzComposeAlertFixture {
        executor: Address::generate(env),
        from: Address::generate(env),
        to: Address::generate(env),
        guid: BytesN::from_array(env, &[1u8; 32]),
        index: 0u32,
        gas: 1000i128,
        value: 500i128,
        message: Bytes::from_array(env, &[1, 2, 3, 4, 5]),
        extra_data: Bytes::from_array(env, &[6, 7, 8]),
        reason: Bytes::from_array(env, &[9, 10]),
    }
}

fn invoke_lz_compose_alert_with_auth<'a>(
    context: &TestSetup,
    endpoint_client: &EndpointV2Client<'a>,
    executor: &Address,
    from: &Address,
    to: &Address,
    guid: &BytesN<32>,
    index: u32,
    gas: i128,
    value: i128,
    message: &Bytes,
    extra_data: &Bytes,
    reason: &Bytes,
) {
    // The endpoint requires authorization from `executor`.
    context.mock_auth(
        executor,
        "lz_compose_alert",
        (executor, from, to, guid, &index, &gas, &value, message, extra_data, reason),
    );
    endpoint_client.lz_compose_alert(executor, from, to, guid, &index, &gas, &value, message, extra_data, reason);
}

// Authorization (executor must authorize)
#[test]
fn test_lz_compose_alert_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let f = default_fixture(env);
    invoke_lz_compose_alert_with_auth(
        &context,
        endpoint_client,
        &f.executor,
        &f.from,
        &f.to,
        &f.guid,
        f.index,
        f.gas,
        f.value,
        &f.message,
        &f.extra_data,
        &f.reason,
    );

    assert_eq_event(
        env,
        &endpoint_client.address,
        LzComposeAlert {
            executor: f.executor.clone(),
            from: f.from.clone(),
            to: f.to.clone(),
            guid: f.guid.clone(),
            index: f.index,
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
fn test_lz_compose_alert_fails_without_executor_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let f = default_fixture(env);
    endpoint_client.lz_compose_alert(
        &f.executor,
        &f.from,
        &f.to,
        &f.guid,
        &f.index,
        &f.gas,
        &f.value,
        &f.message,
        &f.extra_data,
        &f.reason,
    );
}

// Index bounds (<= MAX_COMPOSE_INDEX)
#[test]
fn test_lz_compose_alert_invalid_index_exceeds_max() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let f = default_fixture(env);
    let invalid_index = MAX_COMPOSE_INDEX + 1;
    let result = {
        context.mock_auth(
            &f.executor,
            "lz_compose_alert",
            (
                &f.executor,
                &f.from,
                &f.to,
                &f.guid,
                &invalid_index,
                &f.gas,
                &f.value,
                &f.message,
                &f.extra_data,
                &f.reason,
            ),
        );
        endpoint_client.try_lz_compose_alert(
            &f.executor,
            &f.from,
            &f.to,
            &f.guid,
            &invalid_index,
            &f.gas,
            &f.value,
            &f.message,
            &f.extra_data,
            &f.reason,
        )
    };
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidIndex.into());
}

// Payload edge cases
#[test]
fn test_lz_compose_alert_with_empty_data() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let mut f = default_fixture(env);
    f.gas = 0;
    f.value = 0;
    f.message = Bytes::new(env);
    f.extra_data = Bytes::new(env);
    f.reason = Bytes::new(env);

    invoke_lz_compose_alert_with_auth(
        &context,
        endpoint_client,
        &f.executor,
        &f.from,
        &f.to,
        &f.guid,
        f.index,
        f.gas,
        f.value,
        &f.message,
        &f.extra_data,
        &f.reason,
    );

    assert_eq_event(
        env,
        &endpoint_client.address,
        LzComposeAlert {
            executor: f.executor.clone(),
            from: f.from.clone(),
            to: f.to.clone(),
            guid: f.guid.clone(),
            index: f.index,
            gas: f.gas,
            value: f.value,
            message: f.message.clone(),
            extra_data: f.extra_data.clone(),
            reason: f.reason.clone(),
        },
    );
}
