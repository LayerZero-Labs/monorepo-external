// UI (trybuild) negative test: `#[no_ttl_extension]` rejects arguments.
//
// Purpose:
// - Boundary coverage for attribute parsing (Meta::Path only).

#[common_macros::storage]
pub enum StorageKey {
    #[persistent(u32)]
    #[no_ttl_extension(true)]
    Value,
}

fn main() {}
