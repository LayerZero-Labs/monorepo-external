// UI (trybuild) negative test: `#[oapp]` must be applied to a struct.

use oapp_macros::oapp;

#[oapp]
pub enum NotAStruct {
    A,
}

fn main() {}
