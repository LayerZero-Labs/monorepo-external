// UI (trybuild) test: generated storage API surface type-checks.
//
// Purpose:
// - Ensures the macro-generated methods are callable with the intended signatures:
//   - unit vs named-fields variants
//   - primitive keys passed by value, non-primitive by reference
//   - default getter return type is `T` (not `Option<T>`)
//   - extend_ttl signatures differ for instance vs persistent/temporary

use soroban_sdk::{Address, BytesN, Env};

#[common_macros::storage]
pub enum StorageKey {
    // Unit instance storage.
    #[instance(u32)]
    Counter,

    // Unit instance storage with a default value (getter returns u32).
    #[instance(u32)]
    #[default(0)]
    CounterWithDefault,

    // Persistent storage with non-primitive key (key passed by reference).
    #[persistent(i128)]
    Balance { key: BytesN<32> },

    // Persistent storage + no_ttl_extension still generates the same API surface.
    #[persistent(i128)]
    #[no_ttl_extension]
    BalanceNoTtl { key: BytesN<32> },

    // Persistent storage with primitive key (key passed by value).
    #[persistent(u32)]
    PrimKey { key: u32 },

    // Temporary storage with non-primitive key (key passed by reference).
    #[temporary(bool)]
    TempFlag { user: Address },

    // Name override attribute changes generated function names.
    #[instance(bool)]
    #[name("custom_flag")]
    Flag,
}

#[allow(dead_code)]
fn typecheck_api(env: &Env, bytes: &BytesN<32>, addr: &Address) {
    // Unit instance variant API
    let _: Option<u32> = StorageKey::counter(env);
    StorageKey::set_counter(env, &1u32);
    StorageKey::set_or_remove_counter(env, &Some(1u32));
    StorageKey::remove_counter(env);
    let _: bool = StorageKey::has_counter(env);

    // Unit instance + default getter return type
    let _: u32 = StorageKey::counter_with_default(env);
    StorageKey::set_counter_with_default(env, &2u32);
    StorageKey::set_or_remove_counter_with_default(env, &Some(2u32));
    StorageKey::remove_counter_with_default(env);
    let _: bool = StorageKey::has_counter_with_default(env);

    // Persistent + non-primitive key uses &BytesN<32>
    let _: Option<i128> = StorageKey::balance(env, bytes);
    StorageKey::set_balance(env, bytes, &5i128);
    StorageKey::set_or_remove_balance(env, bytes, &Some(5i128));
    StorageKey::remove_balance(env, bytes);
    let _: bool = StorageKey::has_balance(env, bytes);
    StorageKey::extend_balance_ttl(env, bytes, 1, 2);

    // Persistent + no_ttl_extension (same signatures)
    let _: Option<i128> = StorageKey::balance_no_ttl(env, bytes);
    StorageKey::set_balance_no_ttl(env, bytes, &6i128);
    StorageKey::set_or_remove_balance_no_ttl(env, bytes, &Some(6i128));
    StorageKey::remove_balance_no_ttl(env, bytes);
    let _: bool = StorageKey::has_balance_no_ttl(env, bytes);
    StorageKey::extend_balance_no_ttl_ttl(env, bytes, 1, 2);

    // Persistent + primitive key uses u32 by value
    let _: Option<u32> = StorageKey::prim_key(env, 7u32);
    StorageKey::set_prim_key(env, 7u32, &9u32);
    StorageKey::set_or_remove_prim_key(env, 7u32, &Some(9u32));
    StorageKey::remove_prim_key(env, 7u32);
    let _: bool = StorageKey::has_prim_key(env, 7u32);
    StorageKey::extend_prim_key_ttl(env, 7u32, 1, 2);

    // Temporary + non-primitive key uses &Address
    let _: Option<bool> = StorageKey::temp_flag(env, addr);
    StorageKey::set_temp_flag(env, addr, &true);
    StorageKey::set_or_remove_temp_flag(env, addr, &Some(true));
    StorageKey::remove_temp_flag(env, addr);
    let _: bool = StorageKey::has_temp_flag(env, addr);
    StorageKey::extend_temp_flag_ttl(env, addr, 1, 2);

    // Name override uses the custom name for method generation.
    let _: Option<bool> = StorageKey::custom_flag(env);
    StorageKey::set_custom_flag(env, &true);
    StorageKey::set_or_remove_custom_flag(env, &Some(true));
    StorageKey::remove_custom_flag(env);
    let _: bool = StorageKey::has_custom_flag(env);
}

fn main() {}
