// UI (trybuild) negative test: `#[contract_error]` must be applied to an enum.
//
// Purpose:
// - Ensures non-enum input (struct) is rejected at compile time.
// - Locks down the enum-only contract for downstream users.

#[common_macros::contract_error]
pub struct NotAnEnum;

fn main() {}

