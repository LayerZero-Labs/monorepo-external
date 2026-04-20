// UI (trybuild) negative test: `#[lz_contract(upgradeable(...))]` only accepts `no_migration`.
//
// Purpose:
// - Ensures nested option parsing rejects unknown inner identifiers.
// - Boundary coverage for the wrapper's config parser.

#[common_macros::lz_contract(upgradeable(bad_inner))]
pub struct MyContract;

fn main() {}
