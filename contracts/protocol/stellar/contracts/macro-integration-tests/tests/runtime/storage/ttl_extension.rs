// Runtime test: TTL extension behavior for all storage types.
//
// Purpose:
// - Validates auto TTL extension triggered by get/has operations (persistent only, with stored config).
// - Validates #[no_ttl_extension] disables auto TTL extension for persistent storage.
// - Validates manual extend_ttl function works for all storage types.
//
// Key insight for TTL calculation:
// - TTL = live_until_ledger - current_sequence
// - To trigger auto extension, set sequence so TTL = threshold

use soroban_sdk::{
    contract, contractimpl,
    testutils::{storage::Persistent as _, storage::Temporary as _, Ledger as _},
    BytesN, Env,
};
use utils::ttl_configurable::{TtlConfig, TtlConfigStorage};

#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {}

// ============================================================================
// Storage enums
// ============================================================================

#[common_macros::storage]
pub enum InstanceKeyWithTtl {
    #[instance(u32)]
    #[default(0)]
    Counter,
}

#[common_macros::storage]
pub enum PersistentKeyWithTtl {
    #[persistent(i128)]
    Balance { key: BytesN<32> },

    #[persistent(i128)]
    #[no_ttl_extension]
    BalanceNoAuto { key: BytesN<32> },
}

#[common_macros::storage]
pub enum TemporaryKeyWithTtl {
    #[temporary(bool)]
    Flag { key: BytesN<32> },
}

// ============================================================================
// Storage enum used to verify manual TTL extension without stored config
// ============================================================================

#[common_macros::storage]
pub enum PersistentKeyNoTtl {
    #[persistent(u32)]
    Counter,
}

// ============================================================================
// Tests: Auto TTL extension (persistent only)
// ============================================================================

mod auto_extension {
    use super::*;

    #[test]
    fn persistent_without_provider_does_not_auto_extend() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        let k = BytesN::<32>::from_array(&env, &[7u8; 32]);

        // Establish entry, but do NOT set any stored TTL config.
        env.as_contract(&contract_id, || {
            PersistentKeyWithTtl::set_balance(&env, &k, &1);
        });

        // Move ledger so TTL is small, then ensure get() doesn't extend without provider.
        let (current_ttl, current_seq) = env.as_contract(&contract_id, || {
            (env.storage().persistent().get_ttl(&PersistentKeyWithTtl::Balance(k.clone())), env.ledger().sequence())
        });
        let live_until = current_seq + current_ttl;
        env.ledger().set_sequence_number(live_until.saturating_sub(1));

        env.as_contract(&contract_id, || {
            let ttl_before = env.storage().persistent().get_ttl(&PersistentKeyWithTtl::Balance(k.clone()));
            let _ = PersistentKeyWithTtl::balance(&env, &k);
            let ttl_after = env.storage().persistent().get_ttl(&PersistentKeyWithTtl::Balance(k.clone()));
            assert_eq!(ttl_after, ttl_before);
        });
    }

    #[test]
    fn persistent_auto_ttl() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        let cfg = env.as_contract(&contract_id, || {
            let cfg = TtlConfig::new(100, 110);
            TtlConfigStorage::set_persistent(&env, &cfg);
            cfg
        });
        let k = BytesN::<32>::from_array(&env, &[1u8; 32]);

        // First write to establish entry
        env.as_contract(&contract_id, || {
            PersistentKeyWithTtl::set_balance(&env, &k, &1);
        });

        // Helper closure to test TTL trigger
        let test_trigger = |action: &dyn Fn(&Env)| {
            // Calculate live_until_ledger from current state
            let current_seq = env.ledger().sequence();
            let current_ttl = env.as_contract(&contract_id, || {
                env.storage().persistent().get_ttl(&PersistentKeyWithTtl::Balance(k.clone()))
            });
            let live_until = current_seq + current_ttl;

            // Set sequence so TTL = threshold
            env.ledger().set_sequence_number(live_until - cfg.threshold);

            env.as_contract(&contract_id, || {
                action(&env);
                assert_eq!(
                    env.storage().persistent().get_ttl(&PersistentKeyWithTtl::Balance(k.clone())),
                    cfg.extend_to
                );
            });
        };

        // Test get() triggers auto TTL extension
        test_trigger(&|env| {
            let _ = PersistentKeyWithTtl::balance(env, &k);
        });

        // Test has() triggers auto TTL extension
        test_trigger(&|env| {
            assert!(PersistentKeyWithTtl::has_balance(env, &k));
        });

        // Test set() triggers auto TTL extension (setter always appends auto-extend for persistent storage)
        test_trigger(&|env| {
            PersistentKeyWithTtl::set_balance(env, &k, &2);
        });
    }

    #[test]
    fn persistent_no_ttl_extension_respected() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        let cfg = env.as_contract(&contract_id, || {
            let cfg = TtlConfig::new(100, 110);
            TtlConfigStorage::set_persistent(&env, &cfg);
            cfg
        });
        let k = BytesN::<32>::from_array(&env, &[1u8; 32]);

        let baseline_ttl = env.as_contract(&contract_id, || {
            PersistentKeyWithTtl::set_balance_no_auto(&env, &k, &1);
            env.storage().persistent().get_ttl(&PersistentKeyWithTtl::BalanceNoAuto(k.clone()))
        });

        env.ledger().set_sequence_number(baseline_ttl - cfg.threshold);

        env.as_contract(&contract_id, || {
            let _ = PersistentKeyWithTtl::balance_no_auto(&env, &k);
            let _ = PersistentKeyWithTtl::has_balance_no_auto(&env, &k);
            PersistentKeyWithTtl::set_balance_no_auto(&env, &k, &2);
            assert_eq!(
                env.storage().persistent().get_ttl(&PersistentKeyWithTtl::BalanceNoAuto(k.clone())),
                cfg.threshold
            );
        });
    }

    #[test]
    fn temporary_never_auto_ttl_extends() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        let cfg = env.as_contract(&contract_id, || {
            let cfg = TtlConfig::new(10, 40);
            TtlConfigStorage::set_persistent(&env, &cfg);
            TtlConfigStorage::set_instance(&env, &cfg);
            cfg
        });
        let k = BytesN::<32>::from_array(&env, &[3u8; 32]);

        let baseline_ttl = env.as_contract(&contract_id, || {
            TemporaryKeyWithTtl::set_flag(&env, &k, &true);
            env.storage().temporary().get_ttl(&TemporaryKeyWithTtl::Flag(k.clone()))
        });

        env.ledger().set_sequence_number(baseline_ttl - cfg.threshold);

        env.as_contract(&contract_id, || {
            let _ = TemporaryKeyWithTtl::flag(&env, &k);
            let _ = TemporaryKeyWithTtl::has_flag(&env, &k);
            TemporaryKeyWithTtl::set_flag(&env, &k, &false);
            assert_eq!(env.storage().temporary().get_ttl(&TemporaryKeyWithTtl::Flag(k.clone())), cfg.threshold);
        });
    }
}

// ============================================================================
// Tests: Manual TTL extension
// ============================================================================

mod manual_extend {
    use super::*;

    #[common_macros::storage]
    pub enum TemporaryKeyNoTtl {
        #[temporary(u32)]
        Counter,
    }

    /// Tests manual TTL extension for all three storage types (instance, persistent, temporary).
    #[test]
    fn manual_extend_all_storage_types() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        let k = BytesN::<32>::from_array(&env, &[1u8; 32]);

        // --- Persistent storage: extend_ttl(&key, threshold, extend_to) ---
        let (persistent_ttl, persistent_seq) = env.as_contract(&contract_id, || {
            PersistentKeyWithTtl::set_balance(&env, &k, &100);
            (env.storage().persistent().get_ttl(&PersistentKeyWithTtl::Balance(k.clone())), env.ledger().sequence())
        });
        let persistent_live_until = persistent_seq + persistent_ttl;
        let persistent_threshold = persistent_ttl.saturating_sub(1);
        let persistent_extend_to = persistent_ttl + 200;
        env.ledger().set_sequence_number(persistent_live_until - persistent_threshold);
        env.as_contract(&contract_id, || {
            PersistentKeyWithTtl::extend_balance_ttl(&env, &k, persistent_threshold, persistent_extend_to);
            let updated_ttl = env.storage().persistent().get_ttl(&PersistentKeyWithTtl::Balance(k.clone()));
            assert_eq!(updated_ttl, persistent_extend_to);
        });

        // --- Temporary storage: extend_ttl(&key, threshold, extend_to) ---
        let (temporary_ttl, temporary_seq) = env.as_contract(&contract_id, || {
            TemporaryKeyWithTtl::set_flag(&env, &k, &true);
            (env.storage().temporary().get_ttl(&TemporaryKeyWithTtl::Flag(k.clone())), env.ledger().sequence())
        });
        let temporary_live_until = temporary_seq + temporary_ttl;
        let temporary_threshold = temporary_ttl.saturating_sub(1);
        let temporary_extend_to = temporary_ttl + 100;
        env.ledger().set_sequence_number(temporary_live_until - temporary_threshold);
        env.as_contract(&contract_id, || {
            TemporaryKeyWithTtl::extend_flag_ttl(&env, &k, temporary_threshold, temporary_extend_to);
            let updated_ttl = env.storage().temporary().get_ttl(&TemporaryKeyWithTtl::Flag(k.clone()));
            assert_eq!(updated_ttl, temporary_extend_to);
        });

        // --- Temporary storage (unit variant): extend_ttl(threshold, extend_to) ---
        let (temporary_ttl, temporary_seq) = env.as_contract(&contract_id, || {
            TemporaryKeyNoTtl::set_counter(&env, &42);
            (env.storage().temporary().get_ttl(&TemporaryKeyNoTtl::Counter), env.ledger().sequence())
        });
        let temporary_live_until = temporary_seq + temporary_ttl;
        let temporary_threshold = temporary_ttl.saturating_sub(1);
        let temporary_extend_to = temporary_ttl + 123;
        env.ledger().set_sequence_number(temporary_live_until - temporary_threshold);
        env.as_contract(&contract_id, || {
            TemporaryKeyNoTtl::extend_counter_ttl(&env, temporary_threshold, temporary_extend_to);
            let updated_ttl = env.storage().temporary().get_ttl(&TemporaryKeyNoTtl::Counter);
            assert_eq!(updated_ttl, temporary_extend_to);
        });
    }

    /// Tests that manual TTL extension works even without a stored TTL config.
    #[test]
    fn manual_extend_works_without_provider() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());

        env.as_contract(&contract_id, || {
            PersistentKeyNoTtl::set_counter(&env, &42);
            let current_ttl = env.storage().persistent().get_ttl(&PersistentKeyNoTtl::Counter);
            let current_seq = env.ledger().sequence();
            let live_until = current_seq + current_ttl;

            let threshold = current_ttl.saturating_sub(1);
            let extend_to = current_ttl + 500;
            env.ledger().set_sequence_number(live_until - threshold);

            PersistentKeyNoTtl::extend_counter_ttl(&env, threshold, extend_to);

            let updated_ttl = env.storage().persistent().get_ttl(&PersistentKeyNoTtl::Counter);
            assert_eq!(updated_ttl, extend_to);
        });
    }
}
