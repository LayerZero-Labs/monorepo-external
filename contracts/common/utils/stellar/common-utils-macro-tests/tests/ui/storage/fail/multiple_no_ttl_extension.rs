// UI (trybuild) negative test: multiple `#[no_ttl_extension]` attributes are rejected.

#[common_macros::storage]
pub enum StorageKey {
    #[persistent(u32)]
    #[no_ttl_extension]
    #[no_ttl_extension]
    Counter,
}

fn main() {}
