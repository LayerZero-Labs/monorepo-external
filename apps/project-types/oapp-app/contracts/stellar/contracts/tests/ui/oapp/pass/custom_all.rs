// UI (trybuild) test: `#[oapp(custom = [core, sender, receiver, options_type3])]` works.

use endpoint_v2::Origin;
use oapp::oapp_core::OAppCore;
use oapp::oapp_options_type3::OAppOptionsType3;
use oapp::oapp_receiver::{LzReceiveInternal, OAppReceiver};
use oapp::oapp_sender::OAppSenderInternal;
use oapp_macros::oapp;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};
use utils::rbac::RoleBasedAccessControl;

#[oapp(custom = [core, sender, receiver, options_type3])]
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
    }
}

impl RoleBasedAccessControl for MyOApp {}

#[contractimpl(contracttrait)]
impl OAppCore for MyOApp {}

impl OAppSenderInternal for MyOApp {}

#[contractimpl(contracttrait)]
impl OAppReceiver for MyOApp {}

#[contractimpl(contracttrait)]
impl OAppOptionsType3 for MyOApp {}

fn main() {}
