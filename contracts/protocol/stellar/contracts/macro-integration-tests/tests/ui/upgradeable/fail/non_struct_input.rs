// UI (trybuild) negative test: `#[upgradeable]` must be applied to a struct.

#[common_macros::upgradeable]
pub enum NotAStruct {
    A,
}

fn main() {}
