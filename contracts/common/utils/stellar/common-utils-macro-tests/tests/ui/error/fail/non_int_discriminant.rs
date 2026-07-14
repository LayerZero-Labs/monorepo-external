// UI (trybuild) negative test: only integer discriminants are supported.
//
// Purpose:
// - Ensures non-integer discriminants (string literal, expression, const path) are rejected.
// - The macro expects a literal integer discriminant.

const X: u32 = 7;

#[common_macros::contract_error]
pub enum MyError {
    // Not an integer literal (string)
    A = "1",

    // Not a literal int expression (path)
    B = X,

    // Not a literal int expression (binary expression)
    C = 1 + 2,
}

fn main() {}
