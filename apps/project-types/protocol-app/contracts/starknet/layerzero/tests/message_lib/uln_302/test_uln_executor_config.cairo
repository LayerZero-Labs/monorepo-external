//! ULN executor config tests

use core::num::traits::Zero;
use core::traits::TryInto;
use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::message_lib::uln_302::structs::executor_config::{
    ExecutorConfig, ExecutorConfigResolver,
};
use starknet::ContractAddress;

// Test constants
const EXECUTOR_1: ContractAddress = 1.try_into().unwrap();
const EXECUTOR_2: ContractAddress = 2.try_into().unwrap();
const EXECUTOR_3: ContractAddress = 3.try_into().unwrap();

#[test]
fn test_executor_config_default() {
    let default_config: ExecutorConfig = Default::default();

    assert(default_config.max_message_size == 0, 'default max_message_size wrong');
    assert(default_config.executor.is_zero(), 'default executor wrong');
}

#[test]
fn test_resolve_with_non_zero_custom_config() {
    let default_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let custom_config = ExecutorConfig { max_message_size: 2000, executor: EXECUTOR_2 };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // All custom values should override default values
    assert(resolved.max_message_size == 2000, 'max_message_size not overridden');
    assert(resolved.executor == EXECUTOR_2, 'executor not overridden');
}

#[test]
fn test_resolve_with_zero_custom_max_message_size() {
    let default_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let custom_config = ExecutorConfig {
        max_message_size: 0, // Should use default
        executor: EXECUTOR_2,
    };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // Default max_message_size should be kept when custom is zero
    assert(resolved.max_message_size == 1000, 'maxMessageSize != default');
    assert(resolved.executor == EXECUTOR_2, 'executor != custom');
}

#[test]
fn test_resolve_with_zero_custom_executor() {
    let default_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let custom_config = ExecutorConfig {
        max_message_size: 2000, executor: ZERO_ADDRESS // Should use default
    };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // Default executor should be kept when custom is zero address
    assert(resolved.max_message_size == 2000, 'maxMessageSize != custom');
    assert(resolved.executor == EXECUTOR_1, 'executor != default');
}

#[test]
fn test_resolve_with_all_zero_custom_config() {
    let default_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let custom_config = ExecutorConfig {
        max_message_size: 0, // Should use default
        executor: ZERO_ADDRESS // Should use default
    };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // All default values should be kept
    assert(resolved.max_message_size == 1000, 'maxMessageSize != default');
    assert(resolved.executor == EXECUTOR_1, 'executor != default');
}

#[test]
fn test_resolve_with_zero_default_config() {
    let default_config = ExecutorConfig { max_message_size: 0, executor: ZERO_ADDRESS };

    let custom_config = ExecutorConfig { max_message_size: 2000, executor: EXECUTOR_2 };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // Custom values should override zero defaults
    assert(resolved.max_message_size == 2000, 'maxMessageSize != custom');
    assert(resolved.executor == EXECUTOR_2, 'executor != custom');
}

#[test]
fn test_resolve_with_both_zero_configs() {
    let default_config = ExecutorConfig { max_message_size: 0, executor: ZERO_ADDRESS };

    let custom_config = ExecutorConfig { max_message_size: 0, executor: ZERO_ADDRESS };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // Should result in zero values
    assert(resolved.max_message_size == 0, 'maxMessageSize != zero');
    assert(resolved.executor.is_zero(), 'executor != zero');
}

#[test]
fn test_resolve_with_partial_custom_config() {
    let default_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let custom_config = ExecutorConfig {
        max_message_size: 2000, executor: ZERO_ADDRESS // Should use default
    };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // Mix of custom and default values
    assert(resolved.max_message_size == 2000, 'maxMessageSize != custom');
    assert(resolved.executor == EXECUTOR_1, 'executor != default');
}

#[test]
fn test_resolve_with_same_configs() {
    let default_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let custom_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // Should result in the same values
    assert(resolved.max_message_size == 1000, 'maxMessageSize != default');
    assert(resolved.executor == EXECUTOR_1, 'executor != default');
}

#[test]
fn test_resolve_with_max_values() {
    let default_config = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let custom_config = ExecutorConfig {
        max_message_size: 0xFFFFFFFF, // Max u32 value
        executor: EXECUTOR_3,
    };

    let resolved = ExecutorConfigResolver::resolve(@default_config, @custom_config);

    // Should handle max values correctly
    assert(resolved.max_message_size == 0xFFFFFFFF, 'maxMessageSize != max');
    assert(resolved.executor == EXECUTOR_3, 'executor != custom');
}

#[test]
fn test_executor_config_clone() {
    let original = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let cloned = original.clone();

    // Verify clone works correctly
    assert(cloned.max_message_size == 1000, 'cloned max_message_size wrong');
    assert(cloned.executor == EXECUTOR_1, 'cloned executor wrong');
}

#[test]
fn test_executor_config_equality() {
    let config1 = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let config2 = ExecutorConfig { max_message_size: 1000, executor: EXECUTOR_1 };

    let config3 = ExecutorConfig { max_message_size: 2000, executor: EXECUTOR_1 };

    // Test equality
    assert(config1 == config2, 'configs should be equal');
    assert(config1 != config3, 'configs should not be equal');
}
