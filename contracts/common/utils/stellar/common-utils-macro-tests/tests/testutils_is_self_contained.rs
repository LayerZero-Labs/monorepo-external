//! Compile fixture: enabling only `utils/testutils` must be enough to use
//! `testing_utils` (which imports `soroban_sdk::testutils`). If the package
//! feature does not forward to `soroban-sdk/testutils`, this fails to compile.
//!
//! Lives in the macro-tests package (not utils) so vendored utils crates — which
//! strip `tests/` — never carry a dangling `[[test]]` target.

use soroban_sdk::Env;
use utils::testing_utils;

#[test]
fn testutils_feature_is_self_contained() {
    let env = Env::default();
    let _ = testing_utils::decode_event_topics_data;
    let _ = env;
}
