// UI (trybuild) negative test: storage type attribute must have exactly one type parameter.
//
// Purpose:
// - Ensures multiple type parameters are rejected (e.g., #[persistent(u32, i32)]).

#[common_macros::storage]
pub enum StorageKey {
    #[persistent(u32, i32)]
    A,
}

fn main() {}
