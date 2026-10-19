//! Executor configuration struct

use core::num::traits::Zero;
use starknet::ContractAddress;
use crate::common::constants::ZERO_ADDRESS;

#[derive(Drop, Serde, Clone, PartialEq, starknet::Store)]
pub struct ExecutorConfig {
    pub max_message_size: u32,
    pub executor: ContractAddress,
}

#[derive(Drop, Serde, Clone, PartialEq, starknet::Store)]
pub struct SetDefaultExecutorConfigParam {
    pub dst_eid: u32,
    pub config: ExecutorConfig,
}

impl ExecutorConfigDefault of Default<ExecutorConfig> {
    fn default() -> ExecutorConfig {
        ExecutorConfig { max_message_size: 0, executor: ZERO_ADDRESS }
    }
}

pub trait ExecutorConfigResolver {
    /// Resolves a ULN configuration by merging default and custom configurations
    /// Following the same logic as getUlnConfig in the Solidity implementation
    fn resolve(default_config: @ExecutorConfig, custom_config: @ExecutorConfig) -> ExecutorConfig;
}

pub impl ExecutorConfigResolverImpl of ExecutorConfigResolver {
    fn resolve(default_config: @ExecutorConfig, custom_config: @ExecutorConfig) -> ExecutorConfig {
        let mut resolved_config: ExecutorConfig = default_config.clone();
        if *custom_config.max_message_size != 0 {
            resolved_config.max_message_size = *custom_config.max_message_size;
        }
        if !custom_config.executor.is_zero() {
            resolved_config.executor = *custom_config.executor;
        }
        resolved_config
    }
}
