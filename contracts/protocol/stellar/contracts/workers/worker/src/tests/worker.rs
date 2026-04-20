use super::setup::{bare_worker, TestSetup, WorkerTester};
use crate::{
    errors::WorkerError,
    events::{
        Paused, SetAdmin, SetAllowlist, SetDefaultMultiplierBps, SetDenylist, SetDepositAddress, SetPriceFeed,
        SetSupportedMessageLib, SetSupportedOptionTypes, SetWorkerFeeLib, Unpaused,
    },
    init_worker,
};
use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, Env, IntoVal};
use utils::testing_utils::assert_eq_event;

// pause

#[test]
fn test_set_paused_rejects_unchanged_status() {
    let setup = TestSetup::new();

    setup.mock_owner_auth("set_paused", (false,));
    assert_eq!(setup.client.try_set_paused(&false).unwrap_err().unwrap(), WorkerError::PauseStatusUnchanged.into());
}

#[test]
fn test_set_paused_toggles_state() {
    let setup = TestSetup::new();

    setup.mock_owner_auth("set_paused", (true,));
    setup.client.set_paused(&true);
    assert_eq_event(&setup.env, &setup.contract_id, Paused { pauser: setup.owner.clone() });
    assert_eq!(setup.client.paused(), true);

    setup.mock_owner_auth("set_paused", (false,));
    setup.client.set_paused(&false);
    assert_eq_event(&setup.env, &setup.contract_id, Unpaused { unpauser: setup.owner.clone() });
    assert_eq!(setup.client.paused(), false);
}

// allowlist

#[test]
fn test_allowlist_rejects_duplicate_add() {
    let setup = TestSetup::new();
    let oapp = Address::generate(&setup.env);

    setup.mock_owner_auth("set_allowlist", (&oapp, true));
    setup.client.set_allowlist(&oapp, &true);

    setup.mock_owner_auth("set_allowlist", (&oapp, true));
    assert_eq!(
        setup.client.try_set_allowlist(&oapp, &true).unwrap_err().unwrap(),
        WorkerError::AlreadyOnAllowlist.into()
    );
}

#[test]
fn test_allowlist_rejects_remove_missing() {
    let setup = TestSetup::new();
    let oapp = Address::generate(&setup.env);

    setup.mock_owner_auth("set_allowlist", (&oapp, false));
    assert_eq!(setup.client.try_set_allowlist(&oapp, &false).unwrap_err().unwrap(), WorkerError::NotOnAllowlist.into());
}

#[test]
fn test_allowlist_remove_decrements_size_and_restores_default_acl() {
    let setup = TestSetup::new();
    let oapp_a = Address::generate(&setup.env);
    let oapp_b = Address::generate(&setup.env);

    // Add allowlist entry => allowlist becomes non-empty; non-allowlisted is denied
    assert_eq!(setup.client.is_on_allowlist(&oapp_a), false);
    setup.mock_owner_auth("set_allowlist", (&oapp_a, true));
    setup.client.set_allowlist(&oapp_a, &true);
    assert_eq_event(&setup.env, &setup.contract_id, SetAllowlist { oapp: oapp_a.clone(), allowed: true });
    assert_eq!(setup.client.is_on_allowlist(&oapp_a), true);
    assert_eq!(setup.client.allowlist_size(), 1);
    assert_eq!(setup.client.has_acl(&oapp_a), true);
    assert_eq!(setup.client.has_acl(&oapp_b), false);

    // Remove last allowlist entry => allowlist empty; default allows all (unless denylisted)
    setup.mock_owner_auth("set_allowlist", (&oapp_a, false));
    setup.client.set_allowlist(&oapp_a, &false);
    assert_eq_event(&setup.env, &setup.contract_id, SetAllowlist { oapp: oapp_a.clone(), allowed: false });
    assert_eq!(setup.client.is_on_allowlist(&oapp_a), false);
    assert_eq!(setup.client.allowlist_size(), 0);
    assert_eq!(setup.client.has_acl(&oapp_b), true);
}

// denylist

#[test]
fn test_denylist_rejects_duplicate_add() {
    let setup = TestSetup::new();
    let oapp = Address::generate(&setup.env);

    setup.mock_owner_auth("set_denylist", (&oapp, true));
    setup.client.set_denylist(&oapp, &true);

    setup.mock_owner_auth("set_denylist", (&oapp, true));
    assert_eq!(
        setup.client.try_set_denylist(&oapp, &true).unwrap_err().unwrap(),
        WorkerError::AlreadyOnDenylist.into()
    );
}

#[test]
fn test_denylist_rejects_remove_missing() {
    let setup = TestSetup::new();
    let oapp = Address::generate(&setup.env);

    setup.mock_owner_auth("set_denylist", (&oapp, false));
    assert_eq!(setup.client.try_set_denylist(&oapp, &false).unwrap_err().unwrap(), WorkerError::NotOnDenylist.into());
}

// message_libs

#[test]
fn test_message_lib_add_remove_and_errors() {
    let setup = TestSetup::new();

    let existing = setup.message_libs.get(0).unwrap();
    let new_lib = Address::generate(&setup.env);

    // Add new supported lib
    setup.mock_owner_auth("set_supported_message_lib", (&new_lib, true));
    setup.client.set_supported_message_lib(&new_lib, &true);
    assert_eq_event(
        &setup.env,
        &setup.contract_id,
        SetSupportedMessageLib { message_lib: new_lib.clone(), supported: true },
    );
    assert_eq!(setup.client.is_supported_message_lib(&new_lib), true);

    // Remove it
    setup.mock_owner_auth("set_supported_message_lib", (&new_lib, false));
    setup.client.set_supported_message_lib(&new_lib, &false);
    assert_eq_event(
        &setup.env,
        &setup.contract_id,
        SetSupportedMessageLib { message_lib: new_lib.clone(), supported: false },
    );
    assert_eq!(setup.client.is_supported_message_lib(&new_lib), false);

    // Existing is still supported
    assert_eq!(setup.client.is_supported_message_lib(&existing), true);
}

#[test]
fn test_message_lib_rejects_duplicate_add() {
    let setup = TestSetup::new();
    let existing = setup.message_libs.get(0).unwrap();

    setup.mock_owner_auth("set_supported_message_lib", (&existing, true));
    assert_eq!(
        setup.client.try_set_supported_message_lib(&existing, &true).unwrap_err().unwrap(),
        WorkerError::MessageLibAlreadySupported.into()
    );
}

#[test]
fn test_message_lib_rejects_remove_missing() {
    let setup = TestSetup::new();
    let missing = Address::generate(&setup.env);

    setup.mock_owner_auth("set_supported_message_lib", (&missing, false));
    assert_eq!(
        setup.client.try_set_supported_message_lib(&missing, &false).unwrap_err().unwrap(),
        WorkerError::MessageLibNotSupported.into()
    );
}

// admin-only setters

#[test]
fn test_admin_only_set_default_multiplier_requires_admin_membership() {
    let setup = TestSetup::new();

    let non_admin = Address::generate(&setup.env);
    let bps = 12_000u32;

    // Auth passes, but address isn't in admins list => Unauthorized
    setup.mock_auth(&non_admin, "set_default_multiplier_bps", (&non_admin, bps));
    assert_eq!(
        setup.client.try_set_default_multiplier_bps(&non_admin, &bps).unwrap_err().unwrap(),
        WorkerError::Unauthorized.into()
    );
}

#[test]
fn test_admin_setters_update_storage_and_events() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();

    // set_default_multiplier_bps
    let bps = 12_000u32;
    setup.mock_auth(&admin, "set_default_multiplier_bps", (&admin, bps));
    setup.client.set_default_multiplier_bps(&admin, &bps);
    assert_eq_event(&setup.env, &setup.contract_id, SetDefaultMultiplierBps { multiplier_bps: bps });
    assert_eq!(setup.client.default_multiplier_bps(), bps);

    // set_deposit_address
    let new_deposit = Address::generate(&setup.env);
    setup.mock_auth(&admin, "set_deposit_address", (&admin, &new_deposit));
    setup.client.set_deposit_address(&admin, &new_deposit);
    assert_eq_event(&setup.env, &setup.contract_id, SetDepositAddress { deposit_address: new_deposit.clone() });
    assert_eq!(setup.client.deposit_address(), Some(new_deposit));

    // set_supported_option_types
    let eid_a = 1u32;
    let eid_b = 2u32;

    let option_types = Bytes::from_slice(&setup.env, &[0xAA, 0xBB, 0xCC]);
    setup.mock_auth(&admin, "set_supported_option_types", (&admin, eid_a, option_types.clone()));
    setup.client.set_supported_option_types(&admin, &eid_a, &option_types);
    assert_eq_event(
        &setup.env,
        &setup.contract_id,
        SetSupportedOptionTypes { dst_eid: eid_a, option_types: option_types.clone() },
    );

    assert_eq!(setup.client.get_supported_option_types(&eid_a), Some(option_types));
    assert_eq!(setup.client.get_supported_option_types(&eid_b), None);

    // set_worker_fee_lib
    let new_fee_lib = Address::generate(&setup.env);
    setup.mock_auth(&admin, "set_worker_fee_lib", (&admin, &new_fee_lib));
    setup.client.set_worker_fee_lib(&admin, &new_fee_lib);
    assert_eq_event(&setup.env, &setup.contract_id, SetWorkerFeeLib { fee_lib: new_fee_lib.clone() });
    assert_eq!(setup.client.worker_fee_lib(), Some(new_fee_lib));

    // set_price_feed
    let new_price_feed = Address::generate(&setup.env);
    setup.mock_auth(&admin, "set_price_feed", (&admin, &new_price_feed));
    setup.client.set_price_feed(&admin, &new_price_feed);
    assert_eq_event(&setup.env, &setup.contract_id, SetPriceFeed { price_feed: new_price_feed.clone() });
    assert_eq!(setup.client.price_feed(), Some(new_price_feed));
}

// view functions

#[test]
fn test_acl_allowlist_denylist_precedence() {
    let setup = TestSetup::new();
    let oapp_a = Address::generate(&setup.env);
    let oapp_b = Address::generate(&setup.env);

    // Empty allowlist => allowed unless denylisted
    assert_eq!(setup.client.has_acl(&oapp_a), true);

    // Denylist overrides everything
    assert_eq!(setup.client.is_on_denylist(&oapp_a), false);
    setup.mock_owner_auth("set_denylist", (&oapp_a, true));
    setup.client.set_denylist(&oapp_a, &true);
    assert_eq_event(&setup.env, &setup.contract_id, SetDenylist { oapp: oapp_a.clone(), denied: true });
    assert_eq!(setup.client.is_on_denylist(&oapp_a), true);
    assert_eq!(setup.client.has_acl(&oapp_a), false);

    // Remove from denylist => allowed again (since allowlist is empty)
    setup.mock_owner_auth("set_denylist", (&oapp_a, false));
    setup.client.set_denylist(&oapp_a, &false);
    assert_eq_event(&setup.env, &setup.contract_id, SetDenylist { oapp: oapp_a.clone(), denied: false });
    assert_eq!(setup.client.is_on_denylist(&oapp_a), false);
    assert_eq!(setup.client.has_acl(&oapp_a), true);

    // Add allowlist entry => allowlist becomes non-empty; non-allowlisted is denied
    setup.mock_owner_auth("set_allowlist", (&oapp_a, true));
    setup.client.set_allowlist(&oapp_a, &true);
    assert_eq!(setup.client.allowlist_size(), 1);
    assert_eq!(setup.client.has_acl(&oapp_a), true);
    assert_eq!(setup.client.has_acl(&oapp_b), false);

    // Denylist must override allowlist even for the same OApp.
    setup.mock_owner_auth("set_denylist", (&oapp_a, true));
    setup.client.set_denylist(&oapp_a, &true);
    assert_eq_event(&setup.env, &setup.contract_id, SetDenylist { oapp: oapp_a.clone(), denied: true });
    assert_eq!(setup.client.has_acl(&oapp_a), false);

    // Removing from denylist should restore allowlist effect.
    setup.mock_owner_auth("set_denylist", (&oapp_a, false));
    setup.client.set_denylist(&oapp_a, &false);
    assert_eq_event(&setup.env, &setup.contract_id, SetDenylist { oapp: oapp_a.clone(), denied: false });
    assert_eq!(setup.client.has_acl(&oapp_a), true);
}

// uninitialized getters (BareWorker)

#[test]
fn test_view_panics_when_deposit_address_unset() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let (_cid, client) = bare_worker(&env, &owner);
    assert_eq!(client.deposit_address(), None);
}

#[test]
fn test_view_panics_when_price_feed_unset() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let (_cid, client) = bare_worker(&env, &owner);
    assert_eq!(client.price_feed(), None);
}

#[test]
fn test_view_panics_when_worker_fee_lib_unset() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let (_cid, client) = bare_worker(&env, &owner);
    assert_eq!(client.worker_fee_lib(), None);
}

#[test]
fn test_default_multiplier_bps_returns_zero_when_unset() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let (_cid, client) = bare_worker(&env, &owner);
    assert_eq!(client.default_multiplier_bps(), 0);
}

// init_worker / construction

#[test]
fn test_init_worker_allows_empty_admins() {
    let env = Env::default();

    let owner = Address::generate(&env);
    let admins: soroban_sdk::Vec<Address> = vec![&env];
    let message_libs: soroban_sdk::Vec<Address> = vec![&env, Address::generate(&env)];
    let price_feed = Address::generate(&env);
    let worker_fee_lib = Address::generate(&env);
    let deposit_address = Address::generate(&env);
    let default_multiplier_bps = 10_000u32;

    // Empty admins is now allowed
    let cid = env.register(
        WorkerTester,
        (&owner, &admins, &message_libs, &price_feed, &default_multiplier_bps, &worker_fee_lib, &deposit_address),
    );
    let client = super::setup::WorkerTesterClient::new(&env, &cid);
    assert_eq!(client.admins().len(), 0);
}

#[test]
fn test_init_worker_can_reinitialize() {
    let setup = TestSetup::new();
    let new_admin = Address::generate(&setup.env);
    let new_admins = vec![&setup.env, new_admin.clone()];
    let new_message_lib = Address::generate(&setup.env);
    let new_message_libs = vec![&setup.env, new_message_lib.clone()];

    // Re-initialization is allowed - adds new admins and message libs
    setup.as_contract(|| {
        init_worker::<WorkerTester>(
            &setup.env,
            &new_admins,
            &new_message_libs, // Use new message libs to avoid duplicate error
            &setup.price_feed,
            setup.default_multiplier_bps,
            &setup.worker_fee_lib,
            &setup.deposit_address,
        );
    });

    // Verify new admin and message lib were added
    assert!(setup.client.is_admin(&new_admin));
    assert!(setup.client.is_supported_message_lib(&new_message_lib));
}

#[test]
fn test_init_worker_sets_config_and_defaults() {
    let setup = TestSetup::new();

    assert_eq!(setup.client.paused(), false);
    assert_eq!(setup.client.admins(), setup.admins);
    assert_eq!(setup.client.message_libs(), setup.message_libs);
    assert_eq!(setup.client.price_feed(), Some(setup.price_feed));
    assert_eq!(setup.client.worker_fee_lib(), Some(setup.worker_fee_lib));
    assert_eq!(setup.client.deposit_address(), Some(setup.deposit_address));
    assert_eq!(setup.client.default_multiplier_bps(), setup.default_multiplier_bps);
    assert_eq!(setup.client.allowlist_size(), 0);

    let lib = setup.message_libs.get(0).unwrap();
    assert_eq!(setup.client.is_supported_message_lib(&lib), true);
}

// admin management (admins list)

#[test]
fn test_admin_management_by_owner_adds_and_removes_admin() {
    let setup = TestSetup::new();
    let new_admin = Address::generate(&setup.env);

    setup.mock_owner_auth("set_admin", (&new_admin, true));
    setup.client.set_admin(&new_admin, &true);
    assert_eq_event(&setup.env, &setup.contract_id, SetAdmin { admin: new_admin.clone(), active: true });
    assert_eq!(setup.client.is_admin(&new_admin), true);

    setup.mock_owner_auth("set_admin", (&new_admin, false));
    setup.client.set_admin(&new_admin, &false);
    assert_eq_event(&setup.env, &setup.contract_id, SetAdmin { admin: new_admin.clone(), active: false });
    assert_eq!(setup.client.is_admin(&new_admin), false);
}

#[test]
fn test_admin_management_by_owner_rejects_duplicate_add() {
    let setup = TestSetup::new();
    let existing_admin = setup.admins.get(0).unwrap();

    setup.mock_owner_auth("set_admin", (&existing_admin, true));
    assert_eq!(
        setup.client.try_set_admin(&existing_admin, &true).unwrap_err().unwrap(),
        WorkerError::AdminAlreadyExists.into()
    );
}

#[test]
fn test_admin_management_by_owner_rejects_remove_missing_admin() {
    let setup = TestSetup::new();
    let missing_admin = Address::generate(&setup.env);

    setup.mock_owner_auth("set_admin", (&missing_admin, false));
    assert_eq!(
        setup.client.try_set_admin(&missing_admin, &false).unwrap_err().unwrap(),
        WorkerError::AdminNotFound.into()
    );
}

#[test]
fn test_admin_management_can_remove_last_admin() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let admins: soroban_sdk::Vec<Address> = vec![&env, Address::generate(&env)];
    let message_libs: soroban_sdk::Vec<Address> = vec![&env, Address::generate(&env)];
    let price_feed = Address::generate(&env);
    let worker_fee_lib = Address::generate(&env);
    let deposit_address = Address::generate(&env);
    let default_multiplier_bps = 10_000u32;

    let cid = env.register(
        WorkerTester,
        (&owner, &admins, &message_libs, &price_feed, &default_multiplier_bps, &worker_fee_lib, &deposit_address),
    );
    let client = super::setup::WorkerTesterClient::new(&env, &cid);
    let only_admin = admins.get(0).unwrap();

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &owner,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &cid,
            fn_name: "set_admin",
            args: (&only_admin, false).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    // Removing the last admin is now allowed
    client.set_admin(&only_admin, &false);
    assert_eq!(client.is_admin(&only_admin), false);
    assert_eq!(client.admins().len(), 0);
}

#[test]
fn test_admin_management_by_admin_can_add_admin() {
    let setup = TestSetup::new();
    let caller = setup.admins.get(0).unwrap();
    let new_admin = Address::generate(&setup.env);

    setup.mock_auth(&caller, "set_admin_by_admin_for_test", (&caller, &new_admin, true));
    setup.client.set_admin_by_admin_for_test(&caller, &new_admin, &true);
    assert_eq_event(&setup.env, &setup.contract_id, SetAdmin { admin: new_admin.clone(), active: true });
    assert_eq!(setup.client.is_admin(&new_admin), true);
}

#[test]
fn test_admin_management_by_admin_requires_caller_is_admin() {
    let setup = TestSetup::new();
    let non_admin = Address::generate(&setup.env);
    let new_admin = Address::generate(&setup.env);

    setup.mock_auth(&non_admin, "set_admin_by_admin_for_test", (&non_admin, &new_admin, true));
    assert_eq!(
        setup.client.try_set_admin_by_admin_for_test(&non_admin, &new_admin, &true).unwrap_err().unwrap(),
        WorkerError::Unauthorized.into()
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1207)")] // WorkerError::NotAllowed
fn test_assert_acl_rejects_when_not_allowed() {
    let setup = TestSetup::new();
    let allowed = Address::generate(&setup.env);
    let not_allowed = Address::generate(&setup.env);

    // Make allowlist non-empty so non-allowlisted addresses are denied.
    setup.mock_owner_auth("set_allowlist", (&allowed, true));
    setup.client.set_allowlist(&allowed, &true);

    setup.as_contract(|| {
        crate::assert_acl::<WorkerTester>(&setup.env, &not_allowed);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #1213)")] // WorkerError::UnsupportedMessageLib
fn test_assert_supported_message_lib_rejects_unsupported() {
    let setup = TestSetup::new();
    let unsupported = Address::generate(&setup.env);

    setup.as_contract(|| {
        crate::assert_supported_message_lib::<WorkerTester>(&setup.env, &unsupported);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #1215)")] // WorkerError::WorkerIsPaused
fn test_assert_not_paused_panics_when_paused() {
    let setup = TestSetup::new();

    setup.mock_owner_auth("set_paused", (true,));
    setup.client.set_paused(&true);

    setup.as_contract(|| {
        crate::assert_not_paused::<WorkerTester>(&setup.env);
    });
}
