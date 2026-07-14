// UI (trybuild) test: each single-trait `custom` option compiles.
//
// These are merged into one file to reduce test count while still covering:
// - `custom = [core]`
// - `custom = [sender]`
// - `custom = [receiver]`
// - `custom = [options_type3]`

use endpoint_v2::Origin;
use oapp::oapp_core::OAppCore;
use oapp::oapp_options_type3::OAppOptionsType3;
use oapp::oapp_receiver::{LzReceiveInternal, OAppReceiver};
use oapp::oapp_sender::OAppSenderInternal;
use oapp_macros::oapp;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};
use utils::rbac::RoleBasedAccessControl;

#[oapp(custom = [core])]
#[common_macros::lz_contract]
pub struct MyOAppCustomCore;

impl LzReceiveInternal for MyOAppCustomCore {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
    }
}

impl RoleBasedAccessControl for MyOAppCustomCore {}

#[contractimpl(contracttrait)]
impl OAppCore for MyOAppCustomCore {
    fn oapp_version(_env: &Env) -> (u64, u64) {
        (9, 9)
    }
}

#[oapp(custom = [sender])]
#[common_macros::lz_contract]
pub struct MyOAppCustomSender;

impl LzReceiveInternal for MyOAppCustomSender {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
    }
}

impl OAppSenderInternal for MyOAppCustomSender {}

#[oapp(custom = [receiver])]
#[common_macros::lz_contract]
pub struct MyOAppCustomReceiver;

impl LzReceiveInternal for MyOAppCustomReceiver {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
    }
}

#[contractimpl(contracttrait)]
impl OAppReceiver for MyOAppCustomReceiver {}

#[oapp(custom = [options_type3])]
#[common_macros::lz_contract]
pub struct MyOAppCustomOptionsType3;

impl LzReceiveInternal for MyOAppCustomOptionsType3 {
    fn __lz_receive(
        _env: &Env,
        _origin: &Origin,
        _guid: &BytesN<32>,
        _message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
    }
}

#[contractimpl(contracttrait)]
impl OAppOptionsType3 for MyOAppCustomOptionsType3 {}

fn main() {}
