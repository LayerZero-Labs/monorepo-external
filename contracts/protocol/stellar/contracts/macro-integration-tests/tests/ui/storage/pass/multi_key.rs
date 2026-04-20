// UI (trybuild) test: storage macro supports multi-field (named) keys.
//
// Purpose:
// - Ensures named-fields variants with multiple fields generate correct signatures:
//   - primitive key fields are passed by value
//   - non-primitive key fields are passed by reference (and cloned into the key)

use soroban_sdk::{Address, BytesN, Env};

#[common_macros::storage]
pub enum StorageKey {
    // Mixed key fields: &Address (non-primitive) + u32 (primitive)
    #[persistent(i128)]
    Nonce { user: Address, nonce: u32 },

    // Two non-primitive key fields: both by reference
    #[temporary(bool)]
    TempPair { a: BytesN<32>, b: BytesN<32> },
}

#[allow(dead_code)]
fn typecheck_api(env: &Env, user: &Address, a: &BytesN<32>, b: &BytesN<32>) {
    let _: Option<i128> = StorageKey::nonce(env, user, 1u32);
    StorageKey::set_nonce(env, user, 1u32, &5i128);
    StorageKey::set_or_remove_nonce(env, user, 1u32, &Some(5i128));
    StorageKey::remove_nonce(env, user, 1u32);
    let _: bool = StorageKey::has_nonce(env, user, 1u32);
    StorageKey::extend_nonce_ttl(env, user, 1u32, 1, 2);

    let _: Option<bool> = StorageKey::temp_pair(env, a, b);
    StorageKey::set_temp_pair(env, a, b, &true);
    StorageKey::set_or_remove_temp_pair(env, a, b, &Some(true));
    StorageKey::remove_temp_pair(env, a, b);
    let _: bool = StorageKey::has_temp_pair(env, a, b);
    StorageKey::extend_temp_pair_ttl(env, a, b, 1, 2);
}

fn main() {}
