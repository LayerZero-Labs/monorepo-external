// Runtime test: keyed (named field variant) roundtrip for all storage types.
//
// Purpose:
// - Validates all three storage types (instance, persistent, temporary) work correctly
//   with keyed variants (named fields).
// - Validates key isolation: different keys map to distinct storage entries.
// - Validates single-field and multi-field keyed variants.
// - Complements unkeyed_roundtrip.rs for symmetric coverage.

use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, BytesN, Env};

#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {}

// ============================================================================
// Single-field keyed variants (all storage types)
// ============================================================================

#[common_macros::storage]
pub enum InstanceKeyed {
    #[instance(u32)]
    Value { key: u32 },
}

#[common_macros::storage]
pub enum PersistentKeyed {
    #[persistent(i128)]
    Balance { key: BytesN<32> },

    // Keyed variant with a default value: getter should return the default when absent,
    // while has_* remains false until an explicit set.
    #[persistent(i128)]
    #[default(999)]
    BalanceWithDefault { key: BytesN<32> },
}

#[common_macros::storage]
pub enum TemporaryKeyed {
    #[temporary(bool)]
    Flag { key: Address },
}

#[test]
fn single_field_keyed_all_storage_types() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());

    env.as_contract(&contract_id, || {
        // ====================================================================
        // Instance storage (keyed by primitive u32)
        // ====================================================================
        {
            let k1: u32 = 1;
            let k2: u32 = 2;

            // Initially absent
            assert_eq!(InstanceKeyed::value(&env, k1), None);
            assert_eq!(InstanceKeyed::value(&env, k2), None);
            assert_eq!(InstanceKeyed::has_value(&env, k1), false);
            assert_eq!(InstanceKeyed::has_value(&env, k2), false);

            // Set and verify isolation
            InstanceKeyed::set_value(&env, k1, &100);
            InstanceKeyed::set_value(&env, k2, &200);

            assert_eq!(InstanceKeyed::value(&env, k1), Some(100));
            assert_eq!(InstanceKeyed::value(&env, k2), Some(200));
            assert_eq!(InstanceKeyed::has_value(&env, k1), true);
            assert_eq!(InstanceKeyed::has_value(&env, k2), true);

            // set_or_remove for keyed instance storage
            InstanceKeyed::set_or_remove_value(&env, k1, &Some(123));
            assert_eq!(InstanceKeyed::value(&env, k1), Some(123));
            assert_eq!(InstanceKeyed::has_value(&env, k1), true);

            InstanceKeyed::set_or_remove_value(&env, k1, &None);
            assert_eq!(InstanceKeyed::value(&env, k1), None);
            assert_eq!(InstanceKeyed::has_value(&env, k1), false);

            // Remove k1, k2 unaffected
            InstanceKeyed::remove_value(&env, k1);
            assert_eq!(InstanceKeyed::value(&env, k1), None);
            assert_eq!(InstanceKeyed::value(&env, k2), Some(200));
        }

        // ====================================================================
        // Persistent storage (keyed by BytesN<32>)
        // ====================================================================
        {
            let k1 = BytesN::<32>::from_array(&env, &[1u8; 32]);
            let k2 = BytesN::<32>::from_array(&env, &[2u8; 32]);

            // Initially absent
            assert_eq!(PersistentKeyed::has_balance(&env, &k1), false);
            assert_eq!(PersistentKeyed::has_balance(&env, &k2), false);

            // Set and verify isolation
            PersistentKeyed::set_balance(&env, &k1, &111);
            PersistentKeyed::set_balance(&env, &k2, &222);

            assert_eq!(PersistentKeyed::balance(&env, &k1), Some(111));
            assert_eq!(PersistentKeyed::balance(&env, &k2), Some(222));

            // set_or_remove for keyed persistent storage
            PersistentKeyed::set_or_remove_balance(&env, &k1, &Some(333));
            assert_eq!(PersistentKeyed::balance(&env, &k1), Some(333));
            assert_eq!(PersistentKeyed::has_balance(&env, &k1), true);

            PersistentKeyed::set_or_remove_balance(&env, &k1, &None);
            assert_eq!(PersistentKeyed::balance(&env, &k1), None);
            assert_eq!(PersistentKeyed::has_balance(&env, &k1), false);

            // Remove k1, k2 unaffected
            PersistentKeyed::remove_balance(&env, &k1);
            assert_eq!(PersistentKeyed::has_balance(&env, &k1), false);
            assert_eq!(PersistentKeyed::balance(&env, &k1), None);
            assert_eq!(PersistentKeyed::has_balance(&env, &k2), true);
            assert_eq!(PersistentKeyed::balance(&env, &k2), Some(222));
        }

        // ====================================================================
        // Persistent storage (keyed) with default value
        // ====================================================================
        {
            let k = BytesN::<32>::from_array(&env, &[9u8; 32]);

            // Absent: getter returns default, but has_* is false
            assert_eq!(PersistentKeyed::balance_with_default(&env, &k), 999);
            assert_eq!(PersistentKeyed::has_balance_with_default(&env, &k), false);

            // Present: getter returns stored value, has_* is true
            PersistentKeyed::set_balance_with_default(&env, &k, &111);
            assert_eq!(PersistentKeyed::has_balance_with_default(&env, &k), true);
            assert_eq!(PersistentKeyed::balance_with_default(&env, &k), 111);

            // set_or_remove(Some) updates value
            PersistentKeyed::set_or_remove_balance_with_default(&env, &k, &Some(222));
            assert_eq!(PersistentKeyed::has_balance_with_default(&env, &k), true);
            assert_eq!(PersistentKeyed::balance_with_default(&env, &k), 222);

            // set_or_remove(None) removes and returns to default
            PersistentKeyed::set_or_remove_balance_with_default(&env, &k, &None);
            assert_eq!(PersistentKeyed::has_balance_with_default(&env, &k), false);
            assert_eq!(PersistentKeyed::balance_with_default(&env, &k), 999);

            // Removed: back to default, has_* is false
            PersistentKeyed::remove_balance_with_default(&env, &k);
            assert_eq!(PersistentKeyed::has_balance_with_default(&env, &k), false);
            assert_eq!(PersistentKeyed::balance_with_default(&env, &k), 999);
        }

        // ====================================================================
        // Temporary storage (keyed by Address)
        // ====================================================================
        {
            let k1 = Address::generate(&env);
            let k2 = Address::generate(&env);

            // Initially absent
            assert_eq!(TemporaryKeyed::flag(&env, &k1), None);
            assert_eq!(TemporaryKeyed::flag(&env, &k2), None);

            // Set and verify isolation
            TemporaryKeyed::set_flag(&env, &k1, &true);
            TemporaryKeyed::set_flag(&env, &k2, &false);

            assert_eq!(TemporaryKeyed::flag(&env, &k1), Some(true));
            assert_eq!(TemporaryKeyed::flag(&env, &k2), Some(false));

            // set_or_remove for keyed temporary storage
            TemporaryKeyed::set_or_remove_flag(&env, &k1, &Some(false));
            assert_eq!(TemporaryKeyed::flag(&env, &k1), Some(false));
            assert_eq!(TemporaryKeyed::has_flag(&env, &k1), true);

            TemporaryKeyed::set_or_remove_flag(&env, &k1, &None);
            assert_eq!(TemporaryKeyed::flag(&env, &k1), None);
            assert_eq!(TemporaryKeyed::has_flag(&env, &k1), false);

            // Remove k1, k2 unaffected
            TemporaryKeyed::remove_flag(&env, &k1);
            assert_eq!(TemporaryKeyed::flag(&env, &k1), None);
            assert_eq!(TemporaryKeyed::flag(&env, &k2), Some(false));
        }
    });
}

// ============================================================================
// Multi-field keyed variant
// ============================================================================

#[common_macros::storage]
pub enum MultiFieldKeyed {
    #[persistent(i128)]
    Balance { user: Address, token_id: u64 },
}

#[test]
fn multi_field_keyed_isolation() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());

    env.as_contract(&contract_id, || {
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let token1: u64 = 1;
        let token2: u64 = 2;

        // Initially all absent
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token1), None);
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token2), None);
        assert_eq!(MultiFieldKeyed::balance(&env, &user2, token1), None);
        assert_eq!(MultiFieldKeyed::balance(&env, &user2, token2), None);

        // Set (user1, token1) only
        MultiFieldKeyed::set_balance(&env, &user1, token1, &100);

        // Only (user1, token1) should have value
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token1), Some(100));
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token2), None);
        assert_eq!(MultiFieldKeyed::balance(&env, &user2, token1), None);
        assert_eq!(MultiFieldKeyed::balance(&env, &user2, token2), None);

        // Set more combinations
        MultiFieldKeyed::set_balance(&env, &user1, token2, &200);
        MultiFieldKeyed::set_balance(&env, &user2, token1, &300);

        // Verify all three are independent
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token1), Some(100));
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token2), Some(200));
        assert_eq!(MultiFieldKeyed::balance(&env, &user2, token1), Some(300));
        assert_eq!(MultiFieldKeyed::balance(&env, &user2, token2), None);

        // Remove (user1, token1) should not affect others
        MultiFieldKeyed::remove_balance(&env, &user1, token1);
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token1), None);
        assert_eq!(MultiFieldKeyed::balance(&env, &user1, token2), Some(200));
        assert_eq!(MultiFieldKeyed::balance(&env, &user2, token1), Some(300));
    });
}

#[test]
fn multi_field_keyed_set_or_remove() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());

    env.as_contract(&contract_id, || {
        let user = Address::generate(&env);
        let token: u64 = 42;

        // has returns false when absent
        assert_eq!(MultiFieldKeyed::has_balance(&env, &user, token), false);

        // set_or_remove with Some sets value
        MultiFieldKeyed::set_or_remove_balance(&env, &user, token, &Some(500));
        assert_eq!(MultiFieldKeyed::has_balance(&env, &user, token), true);
        assert_eq!(MultiFieldKeyed::balance(&env, &user, token), Some(500));

        // set_or_remove with None removes value
        MultiFieldKeyed::set_or_remove_balance(&env, &user, token, &None);
        assert_eq!(MultiFieldKeyed::has_balance(&env, &user, token), false);
        assert_eq!(MultiFieldKeyed::balance(&env, &user, token), None);
    });
}
