use endpoint_v2::Origin;
use oapp::oapp_receiver::LzReceiveInternal;
use oapp_macros::oapp;
use soroban_sdk::{contractimpl, symbol_short, Address, Bytes, BytesN, Env};

mod oapp_core;
mod options_type3;
mod receiver;
mod sender;

/// Shared contract used by oapp-macros runtime tests.
///
/// Notes:
/// - `#[oapp]` generates only trait impls. User must apply `#[lz_contract]` (or similar) for contract + TTL + Auth.
/// - Default trait impls: `OAppCore`, `OAppReceiver`, `OAppOptionsType3`, `OAppSenderInternal`
#[oapp]
#[common_macros::lz_contract]
pub struct TestOApp;

impl LzReceiveInternal for TestOApp {
    fn __lz_receive(
        env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        // Mark that the internal handler was invoked.
        env.storage().instance().set(&symbol_short!("lzr_c"), &true);
    }
}

#[contractimpl]
impl TestOApp {
    /// Initializes owner and stores an endpoint address for `OAppCore::endpoint`.
    pub fn init(env: Env, owner: Address, endpoint: Address) {
        Self::init_owner(&env, &owner);
        oapp::oapp_core::OAppCoreStorage::set_endpoint(&env, &endpoint);
    }

    pub fn lz_receive_called(env: Env) -> bool {
        env.storage().instance().get(&symbol_short!("lzr_c")).unwrap_or(false)
    }
}
