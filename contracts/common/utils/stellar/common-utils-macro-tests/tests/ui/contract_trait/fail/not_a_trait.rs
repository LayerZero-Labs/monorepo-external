// UI (trybuild) negative test: `#[contract_trait]` must be applied to a trait.

#[common_macros::contract_trait]
pub struct NotATrait;

fn main() {}
