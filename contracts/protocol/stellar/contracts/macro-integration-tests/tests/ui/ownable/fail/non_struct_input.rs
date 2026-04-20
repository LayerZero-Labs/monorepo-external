// UI (trybuild) negative test: `#[ownable]` must be applied to a struct.

#[common_macros::ownable]
pub enum NotAStruct {
    A,
}

fn main() {}
