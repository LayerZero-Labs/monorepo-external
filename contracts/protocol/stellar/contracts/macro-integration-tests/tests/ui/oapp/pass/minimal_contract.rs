// UI (trybuild) test: minimal `#[oapp]` usage compiles.
//
// Purpose:
// - Verifies `#[oapp]` generates default trait impls. User applies `#[lz_contract]` for contract + TTL + Auth.
// - Verifies the user must implement `LzReceiveInternal`.

use endpoint_v2::Origin;
use oapp::oapp_receiver::LzReceiveInternal;
use oapp_macros::oapp;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

#[oapp]
#[common_macros::lz_contract]
pub struct MyOApp;

impl LzReceiveInternal for MyOApp {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        // No-op.
    }
}

#[contractimpl]
impl MyOApp {
    pub fn init(env: Env, owner: Address, endpoint: Address) {
        // `#[lz_contract]` (user-provided) provides init_owner and Auth.
        Self::init_owner(&env, &owner);
        oapp::oapp_core::OAppCoreStorage::set_endpoint(&env, &endpoint);

        // Type-check: the trait impls exist.
        let _ = <Self as oapp::oapp_core::OAppCore>::oapp_version(&env);
        let _ = <Self as oapp::oapp_receiver::OAppReceiver>::next_nonce(
            &env,
            1,
            &BytesN::<32>::from_array(&env, &[0u8; 32]),
        );
    }
}

#[oapp(custom = [])]
#[common_macros::lz_contract]
pub struct MyOAppCustomEmpty;

impl LzReceiveInternal for MyOAppCustomEmpty {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        // No-op.
    }
}

fn main() {}
