// UI (trybuild) negative test: non-unit variants are rejected.
//
// Purpose:
// - Ensures tuple variants and struct variants cause a compile-time failure.
// - The macro only supports unit variants.

#[common_macros::contract_error]
pub enum MyError {
    Tuple(u32),
    Struct { x: u32 },
}

fn main() {}
