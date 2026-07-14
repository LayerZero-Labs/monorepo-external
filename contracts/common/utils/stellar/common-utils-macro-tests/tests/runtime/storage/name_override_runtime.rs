// Runtime test: #[name] attribute generates correct function names.
//
// Purpose:
// - Validates that #[name("custom")] attribute generates functions with the custom name.
// - Ensures the generated API (custom_counter, set_custom_counter, etc.) works at runtime.
// - Complements UI test that only verifies compilation.

use soroban_sdk::{contract, contractimpl, Env};

#[common_macros::storage]
pub enum StorageKey {
    #[instance(u32)]
    #[default(0)]
    #[name("custom_counter")]
    MyInternalCounter,
}

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {}

#[test]
fn name_override_generates_correct_functions() {
    let env = Env::default();
    let contract_id = env.register(MyContract, ());

    env.as_contract(&contract_id, || {
        // Verify getter uses custom name (custom_counter, not my_internal_counter)
        let v0 = StorageKey::custom_counter(&env);
        assert_eq!(v0, 0); // default value

        // Verify has uses custom name
        assert_eq!(StorageKey::has_custom_counter(&env), false);

        // Verify setter uses custom name
        StorageKey::set_custom_counter(&env, &42);
        assert_eq!(StorageKey::has_custom_counter(&env), true);
        assert_eq!(StorageKey::custom_counter(&env), 42);

        // Verify set_or_remove uses custom name
        StorageKey::set_or_remove_custom_counter(&env, &Some(100));
        assert_eq!(StorageKey::custom_counter(&env), 100);

        // Verify remover uses custom name
        StorageKey::remove_custom_counter(&env);
        assert_eq!(StorageKey::has_custom_counter(&env), false);
        assert_eq!(StorageKey::custom_counter(&env), 0); // back to default
    });
}

