// UI (trybuild) negative test: `#[lz_contract(...)]` rejects unknown options.

#[common_macros::lz_contract(unknown_option)]
pub struct MyContract;

fn main() {}
