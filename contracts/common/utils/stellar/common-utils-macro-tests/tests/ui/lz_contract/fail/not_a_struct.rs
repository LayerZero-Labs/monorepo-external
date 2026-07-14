// UI (trybuild) negative test: `#[lz_contract]` must be applied to a struct.

#[common_macros::lz_contract]
pub enum NotAStruct {
    A,
}

fn main() {}
