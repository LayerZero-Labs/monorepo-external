// UI (trybuild) negative test: multiple `#[default(...)]` attributes are rejected.

#[common_macros::storage]
pub enum StorageKey {
    #[persistent(u32)]
    #[default(0)]
    #[default(1)]
    Counter,
}

fn main() {}
