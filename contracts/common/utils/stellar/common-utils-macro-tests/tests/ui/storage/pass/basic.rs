// UI (trybuild) test: consolidated storage macro "basic" pass coverage.
//
// This replaces several small fixtures by covering them all in one enum:
// - instance unit variant
// - default value on variant
// - persistent named-fields (keyed) variant
// - temporary unit variant with Option value type
// - name override attribute
// - no_ttl_extension (persistent only) + normal persistent variant

use soroban_sdk::{Address, BytesN};

#[common_macros::storage]
pub enum StorageKey {
    // Instance unit variant (basic).
    #[instance(u32)]
    Counter,

    // Default value on variant (getter return type changes, covered elsewhere too).
    #[instance(u32)]
    #[default(0)]
    CounterWithDefault,

    // Persistent named-fields (keyed) variant (also covers "storage macro compiles" baseline).
    #[persistent(i128)]
    Balance { key: BytesN<32> },

    // no_ttl_extension accepted on persistent variants.
    #[persistent(i128)]
    #[no_ttl_extension]
    BalanceNoTtl { key: BytesN<32> },

    // Temporary storage with Option value type.
    #[temporary(Option<Address>)]
    MaybeOwner,

    // Name override attribute on a variant.
    #[instance(bool)]
    #[name("custom_flag")]
    Flag,
}

fn main() {}
