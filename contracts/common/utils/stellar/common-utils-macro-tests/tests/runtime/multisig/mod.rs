use soroban_sdk::contract;

mod admin_entrypoints;
mod self_auth;

/// Shared contract used by multisig runtime tests.
#[contract]
#[common_macros::multisig]
pub struct TestContract;
