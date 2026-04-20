extern crate std;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, IntoVal,
};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::Uln302Error,
    events::DefaultExecutorConfigsSet,
    interfaces::{ExecutorConfig, SendUln302Client, SetDefaultExecutorConfigParam},
    tests::setup::{setup, TestSetup},
};

#[test]
fn test_set_default_executor_configs() {
    let setup = setup();
    let executor1 = setup.register_executable_address();
    let executor2 = setup.register_executable_address();

    let TestSetup { env, uln302, owner, .. } = setup;

    let executor_configs = vec![
        &env,
        SetDefaultExecutorConfigParam {
            dst_eid: 100,
            config: ExecutorConfig { max_message_size: 1000, executor: executor1.clone() },
        },
        SetDefaultExecutorConfigParam {
            dst_eid: 101,
            config: ExecutorConfig { max_message_size: 2000, executor: executor2.clone() },
        },
    ];

    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "set_default_executor_configs",
            args: (&executor_configs,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    uln302.set_default_executor_configs(&executor_configs);

    // Assert DefaultExecutorConfigSet event was published with all params
    assert_eq_event(&env, &uln302.address, DefaultExecutorConfigsSet { params: executor_configs.clone() });

    let uln302_send_client = SendUln302Client::new(&env, &uln302.address);
    for config_param in executor_configs.clone() {
        assert_eq!(uln302_send_client.default_executor_config(&config_param.dst_eid), Some(config_param.config));
    }
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_default_executor_configs_authorization() {
    let TestSetup { env, uln302, .. } = setup();

    let executor = Address::generate(&env);
    let executor_configs = vec![
        &env,
        SetDefaultExecutorConfigParam { dst_eid: 100, config: ExecutorConfig { max_message_size: 1000, executor } },
    ];

    uln302.set_default_executor_configs(&executor_configs);
}

#[test]
fn test_set_default_executor_configs_zero_message_size() {
    let TestSetup { env, uln302, .. } = setup();

    let executor = Address::generate(&env);
    let executor_configs = vec![
        &env,
        SetDefaultExecutorConfigParam { dst_eid: 100, config: ExecutorConfig { max_message_size: 0, executor } },
    ];

    env.mock_all_auths();
    let result = uln302.try_set_default_executor_configs(&executor_configs);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::ZeroMessageSize.into());
}

#[test]
fn test_default_executor_config_not_found() {
    // Sui equivalent: test_error_no_default_executor_config
    // Attempt to get executor config without setting it first
    let TestSetup { env, uln302, .. } = setup();

    let uln302_send_client = SendUln302Client::new(&env, &uln302.address);

    // Try to get default config for an EID that hasn't been configured
    let config = uln302_send_client.default_executor_config(&999);
    assert_eq!(config, None);
}
