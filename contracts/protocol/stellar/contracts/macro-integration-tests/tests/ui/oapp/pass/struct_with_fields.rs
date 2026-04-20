// UI (trybuild) test: `#[oapp]` preserves struct attributes + fields.

use endpoint_v2::Origin;
use oapp::oapp_receiver::LzReceiveInternal;
use oapp_macros::oapp;
use soroban_sdk::{Address, Bytes, BytesN, Env};

#[oapp]
#[common_macros::lz_contract]
#[derive(Clone, Debug)]
pub struct MyOApp {
    pub x: u32,
}

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

#[oapp]
#[common_macros::lz_contract]
pub struct MyOAppTuple(u32, bool);

impl LzReceiveInternal for MyOAppTuple {
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

fn main() {
    // Ensure tuple fields are preserved by macro expansion.
    let _ = MyOAppTuple(1, true);
}
