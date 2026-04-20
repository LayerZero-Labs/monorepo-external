// UI (trybuild) negative test: discriminant values must be monotonically increasing.
//
// Purpose:
// - Ensures the macro rejects explicit discriminants that decrease relative to the previous value.

#[common_macros::contract_error]
pub enum MyError {
    A = 10,
    B = 9,
}

fn main() {}
