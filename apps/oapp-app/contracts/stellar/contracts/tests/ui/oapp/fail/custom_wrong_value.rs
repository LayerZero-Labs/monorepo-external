// UI (trybuild) negative test: `custom` must be a bracketed list.

use oapp_macros::oapp;

#[oapp(custom = core)]
pub struct MyOApp;

fn main() {}
