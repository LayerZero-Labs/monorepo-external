// UI (trybuild) negative test: tuple variants are rejected.
//
// Purpose:
// - Ensures only unit variants or named-fields variants are supported.
// - Tuple variants (e.g., Foo(u32)) must fail compilation.

#[common_macros::storage]
pub enum StorageKey {
    #[instance(u32)]
    Tuple(u32),
}

fn main() {}
