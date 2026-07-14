// UI (trybuild) negative test: unknown attribute on a variant is rejected.
//
// Purpose:
// - Ensures the storage macro rejects unsupported attributes on variants.

#[common_macros::storage]
pub enum StorageKey {
    #[instance(u32)]
    #[wat]
    Counter,
}

fn main() {}
