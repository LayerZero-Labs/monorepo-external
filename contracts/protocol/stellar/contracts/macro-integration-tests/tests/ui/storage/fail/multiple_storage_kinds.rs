// UI (trybuild) negative test: variant must specify exactly one storage kind.

#[common_macros::storage]
pub enum StorageKey {
    #[instance(u32)]
    #[persistent(u32)]
    Counter,
}

fn main() {}
