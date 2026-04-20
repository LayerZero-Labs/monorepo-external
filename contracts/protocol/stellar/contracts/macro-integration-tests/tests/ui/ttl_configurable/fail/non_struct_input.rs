// UI (trybuild) negative test: `#[ttl_configurable]` must be applied to a struct.

#[common_macros::ttl_configurable]
pub enum NotAStruct {
    A,
}

fn main() {}
