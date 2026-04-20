// UI (trybuild) negative test: discriminant values must fit in `u32`.
//
// Purpose:
// - Ensures values > u32::MAX are rejected at compile time.

#[common_macros::contract_error]
pub enum MyError {
    A = 4294967296,
}

fn main() {}
