// UI (trybuild) negative test: `#[oapp]` requires `LzReceiveInternal` to be implemented.

use oapp_macros::oapp;

#[oapp]
#[common_macros::lz_contract]
pub struct MyOApp;

fn main() {}
