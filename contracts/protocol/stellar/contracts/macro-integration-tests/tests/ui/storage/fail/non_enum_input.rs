// UI (trybuild) negative test: `#[storage]` must be applied to an enum.
//
// Purpose:
// - Ensures non-enum input (struct) is rejected at compile time.
// - Locks down the enum-only contract for downstream users.

#[common_macros::storage]
pub struct NotAnEnum;

fn main() {}
