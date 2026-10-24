use soroban_sdk::{vec, Address, Env, Vec};

use crate::interfaces::{ExecutorConfig, UlnConfig};

impl UlnConfig {
    pub fn new(
        confirmations: u64,
        required_dvns: &Vec<Address>,
        optional_dvns: &Vec<Address>,
        optional_dvn_threshold: u32,
    ) -> Self {
        UlnConfig {
            confirmations,
            required_dvns: required_dvns.clone(),
            optional_dvns: optional_dvns.clone(),
            optional_dvn_threshold,
        }
    }

    pub fn generate(
        env: &Env,
        confirmations: u64,
        num_required_dvns: u32,
        num_optional_dvns: u32,
        optional_dvn_threshold: u32,
    ) -> Self {
        use soroban_sdk::testutils::Address as _;

        let mut required_dvns = vec![env];
        for _ in 0..num_required_dvns {
            required_dvns.push_back(Address::generate(env));
        }

        let mut optional_dvns = vec![env];
        for _ in 0..num_optional_dvns {
            optional_dvns.push_back(Address::generate(env));
        }

        UlnConfig { confirmations, required_dvns, optional_dvns, optional_dvn_threshold }
    }
}

impl ExecutorConfig {
    pub fn new(max_message_size: u32, executor: &Address) -> Self {
        ExecutorConfig { max_message_size, executor: executor.clone() }
    }

    pub fn generate(env: &Env, max_message_size: u32) -> Self {
        use soroban_sdk::testutils::Address as _;
        ExecutorConfig { max_message_size, executor: Address::generate(env) }
    }
}
