// UI (trybuild) negative test: `#[multisig]` must be applied to a struct.

#[common_macros::multisig]
pub enum NotAStruct {
    A,
}

fn main() {}
