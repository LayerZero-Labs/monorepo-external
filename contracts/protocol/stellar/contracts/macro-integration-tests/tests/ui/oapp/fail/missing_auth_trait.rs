// UI (trybuild) negative test: `#[oapp]` requires a contract macro such as `#[lz_contract]`.
//
// Purpose:
// - Ensures we fail compilation when a struct uses `#[oapp]` without applying
//   `#[common_macros::lz_contract]` or `#[soroban_sdk::contract]` (or similar).

use endpoint_v2::Origin;
use oapp::oapp_receiver::LzReceiveInternal;
use oapp_macros::oapp;
use soroban_sdk::{Address, Bytes, BytesN, Env};

#[oapp]
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

fn main() {}
