// UI (trybuild) negative test: `#[contract_impl]` must be applied to an `impl` block.

#[common_macros::contract_impl]
pub fn not_an_impl() {}

fn main() {}
