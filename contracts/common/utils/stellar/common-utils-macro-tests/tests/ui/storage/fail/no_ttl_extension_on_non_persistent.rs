// UI (trybuild) negative test: #[no_ttl_extension] is only valid on persistent storage variants.

#[common_macros::storage]
pub enum StorageKey {
    #[instance(u32)]
    #[no_ttl_extension]
    Counter,
}

fn main() {}
