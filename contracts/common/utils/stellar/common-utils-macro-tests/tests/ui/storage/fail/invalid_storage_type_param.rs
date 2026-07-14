// UI (trybuild) negative test: invalid storage value type parameter is rejected.
//
// Purpose:
// - Ensures the type parameter must parse as a Rust type (`syn::Type`).
// - Locks down downstream UX for invalid inputs like string literals.

#[common_macros::storage]
pub enum StorageKey {
    #[persistent("not_a_type")]
    Bad,
}

fn main() {}
