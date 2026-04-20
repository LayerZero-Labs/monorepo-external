// Runtime test: unkeyed (unit variant) roundtrip for all storage types.
//
// Purpose:
// - Validates all three storage types (instance, persistent, temporary) work correctly
//   with unit variants (no key fields).
// - Validates complete lifecycle: set -> has -> get -> remove -> get returns default/None.
// - Validates default attribute behavior.

use soroban_sdk::{contract, contractimpl, Env};

#[common_macros::storage]
pub enum InstanceKey {
    #[instance(u32)]
    #[default(0)]
    Counter,
}

#[common_macros::storage]
pub enum PersistentKey {
    #[persistent(u64)]
    Counter,
}

#[common_macros::storage]
pub enum PersistentKeyWithDefault {
    #[persistent(u64)]
    #[default(42)]
    Value,
}

#[common_macros::storage]
pub enum TemporaryKey {
    #[temporary(bool)]
    Flag,
}

#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {}

#[test]
fn all_storage_types_unkeyed_roundtrip() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());

    env.as_contract(&contract_id, || {
        // ====================================================================
        // Instance storage (with default)
        // ====================================================================
        {
            // Default when not set
            assert_eq!(InstanceKey::counter(&env), 0);
            assert_eq!(InstanceKey::has_counter(&env), false);

            // Set value
            InstanceKey::set_counter(&env, &5);
            assert_eq!(InstanceKey::has_counter(&env), true);
            assert_eq!(InstanceKey::counter(&env), 5);

            // set_or_remove with Some updates value
            InstanceKey::set_or_remove_counter(&env, &Some(10));
            assert_eq!(InstanceKey::counter(&env), 10);

            // set_or_remove with None removes value
            InstanceKey::set_or_remove_counter(&env, &None);
            assert_eq!(InstanceKey::has_counter(&env), false);
            assert_eq!(InstanceKey::counter(&env), 0);
        }

        // ====================================================================
        // Persistent storage (without default)
        // ====================================================================
        {
            // Initially absent, returns None
            assert_eq!(PersistentKey::counter(&env), None);
            assert_eq!(PersistentKey::has_counter(&env), false);

            // set_or_remove with Some sets value
            PersistentKey::set_or_remove_counter(&env, &Some(100));
            assert_eq!(PersistentKey::has_counter(&env), true);
            assert_eq!(PersistentKey::counter(&env), Some(100));

            // Update value
            PersistentKey::set_counter(&env, &200);
            assert_eq!(PersistentKey::counter(&env), Some(200));

            // set_or_remove with None removes value
            PersistentKey::set_or_remove_counter(&env, &None);
            assert_eq!(PersistentKey::has_counter(&env), false);
            assert_eq!(PersistentKey::counter(&env), None);
        }

        // ====================================================================
        // Persistent storage (with default)
        // ====================================================================
        {
            // Returns default value when not set
            assert_eq!(PersistentKeyWithDefault::value(&env), 42);
            assert_eq!(PersistentKeyWithDefault::has_value(&env), false);

            // Set value overrides default
            PersistentKeyWithDefault::set_value(&env, &100);
            assert_eq!(PersistentKeyWithDefault::has_value(&env), true);
            assert_eq!(PersistentKeyWithDefault::value(&env), 100);

            // set_or_remove(Some) updates value
            PersistentKeyWithDefault::set_or_remove_value(&env, &Some(200));
            assert_eq!(PersistentKeyWithDefault::has_value(&env), true);
            assert_eq!(PersistentKeyWithDefault::value(&env), 200);

            // set_or_remove(None) removes and returns to default
            PersistentKeyWithDefault::set_or_remove_value(&env, &None);
            assert_eq!(PersistentKeyWithDefault::has_value(&env), false);
            assert_eq!(PersistentKeyWithDefault::value(&env), 42);

            // Remove value returns to default
            PersistentKeyWithDefault::remove_value(&env);
            assert_eq!(PersistentKeyWithDefault::has_value(&env), false);
            assert_eq!(PersistentKeyWithDefault::value(&env), 42);
        }

        // ====================================================================
        // Temporary storage (without default)
        // ====================================================================
        {
            // Initially absent, returns None
            assert_eq!(TemporaryKey::flag(&env), None);
            assert_eq!(TemporaryKey::has_flag(&env), false);

            // set_or_remove with Some sets value
            TemporaryKey::set_or_remove_flag(&env, &Some(true));
            assert_eq!(TemporaryKey::has_flag(&env), true);
            assert_eq!(TemporaryKey::flag(&env), Some(true));

            // Update value
            TemporaryKey::set_flag(&env, &false);
            assert_eq!(TemporaryKey::flag(&env), Some(false));

            // set_or_remove with None removes value
            TemporaryKey::set_or_remove_flag(&env, &None);
            assert_eq!(TemporaryKey::has_flag(&env), false);
            assert_eq!(TemporaryKey::flag(&env), None);
        }
    });
}
