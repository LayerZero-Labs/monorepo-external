// UI (trybuild) test: `#[contract_error]` basic pass coverage.
//
// Purpose:
// - Covers auto discriminants (no explicit values).
// - Covers mixed discriminants (explicit + implicit).
// - Ensures variant attributes (e.g. doc strings) are allowed/preserved.

#[common_macros::contract_error]
pub enum MyError {
    // Auto discriminants + variant attributes
    #[doc = "A documented error variant (auto discriminant)."]
    A,

    #[doc = "Another documented error variant (auto discriminant)."]
    B,

    // Mixed discriminants
    C = 20,
    D,
}

fn main() {}
