// UI (trybuild) negative test: multiple `#[name("...")]` attributes are rejected.

#[common_macros::storage]
pub enum StorageKey {
    #[persistent(u32)]
    #[name("a")]
    #[name("b")]
    Counter,
}

fn main() {}
