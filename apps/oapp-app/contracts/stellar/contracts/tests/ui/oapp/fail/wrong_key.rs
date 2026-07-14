// UI (trybuild) negative test: only `custom = [...]` is accepted.

use oapp_macros::oapp;

#[oapp(nope = [core])]
pub struct MyOApp;

fn main() {}
