// UI (trybuild) negative test: `#[ttl_extendable]` must be applied to a struct.

#[common_macros::ttl_extendable]
pub enum NotAStruct {
    A,
}

fn main() {}
