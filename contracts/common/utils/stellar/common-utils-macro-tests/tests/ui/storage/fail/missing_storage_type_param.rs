// UI (trybuild) negative test: missing storage value type parameter is rejected.
//
// Purpose:
// - Ensures storage kind attributes (instance/persistent/temporary) require exactly one type parameter.
// - Locks down downstream UX for the common mistake: `#[instance]` (missing type).

#[common_macros::storage]
pub enum StorageKey {
    #[instance]
    Counter,
}

fn main() {}
