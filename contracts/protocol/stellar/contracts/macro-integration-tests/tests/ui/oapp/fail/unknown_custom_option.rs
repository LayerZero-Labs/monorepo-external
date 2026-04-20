// UI (trybuild) negative test: unknown `custom` option is rejected.

use oapp_macros::oapp;

#[oapp(custom = [core, not_a_real_option])]
pub struct MyOApp;

fn main() {}
