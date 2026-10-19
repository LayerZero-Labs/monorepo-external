use crate::{dvn::LzDVN, tests::setup::TestSetup, DVNClient, DstConfig, DstConfigParam, IDVN};
use endpoint_v2::FeeRecipient;
use fee_lib_interfaces::{DvnFeeParams, IDvnFeeLib};
use message_lib_common::interfaces::ILayerZeroDVN;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, AuthorizedFunction},
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,
};
use worker::Worker;

fn with_contract<F, R>(setup: &TestSetup, f: F) -> R
where
    F: FnOnce() -> R,
{
    setup.env.as_contract(&setup.contract_id, f)
}

fn new_addr(env: &Env) -> Address {
    Address::generate(env)
}

fn grant_allowlist(setup: &TestSetup, oapp: &Address) {
    with_contract(setup, || {
        LzDVN::set_allowlist(&setup.env, oapp, true);
    });
}

fn configure_dst_config(setup: &TestSetup, dst_eid: u32, config: DstConfig) {
    let admin = setup.admins.get(0).unwrap();
    let params = vec![&setup.env, DstConfigParam { dst_eid, config }];
    with_contract(setup, || {
        LzDVN::set_dst_config(&setup.env, &admin, &params);
    });
}

fn configure_fee_lib(setup: &TestSetup, fee_lib: &Address, default_multiplier: u32) {
    let admin = setup.admins.get(0).unwrap();
    with_contract(setup, || {
        LzDVN::set_worker_fee_lib(&setup.env, &admin, fee_lib);
    });
    with_contract(setup, || {
        LzDVN::set_default_multiplier_bps(&setup.env, &admin, default_multiplier);
    });
}

#[test]
fn test_vid_returns_configured_value() {
    let setup = TestSetup::new(1);
    let client = DVNClient::new(&setup.env, &setup.contract_id);
    assert_eq!(client.vid(), crate::tests::setup::VID);
}

#[test]
fn test_dst_config_not_set_returns_none() {
    let setup = TestSetup::new(1);
    let client = DVNClient::new(&setup.env, &setup.contract_id);
    assert_eq!(client.dst_config(&999), None);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // DvnError::EidNotSupported
fn test_get_fee_missing_dst_config_panics() {
    let setup = TestSetup::new(1);
    let send_lib = new_addr(&setup.env);
    let sender = new_addr(&setup.env);
    let packet_header = Bytes::new(&setup.env);
    let payload_hash = BytesN::from_array(&setup.env, &[0u8; 32]);
    let options = Bytes::new(&setup.env);

    with_contract(&setup, || {
        LzDVN::get_fee(&setup.env, &send_lib, &sender, 999, &packet_header, &payload_hash, 1, &options);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #1207)")] // WorkerError::NotAllowed
fn test_get_fee_not_allowed_due_to_allowlist() {
    let setup = TestSetup::new(1);
    let allowed = new_addr(&setup.env);
    grant_allowlist(&setup, &allowed);

    let send_lib = new_addr(&setup.env);
    let sender = new_addr(&setup.env);
    let packet_header = Bytes::new(&setup.env);
    let payload_hash = BytesN::from_array(&setup.env, &[0u8; 32]);
    let options = Bytes::new(&setup.env);

    with_contract(&setup, || {
        LzDVN::get_fee(&setup.env, &send_lib, &sender, 1, &packet_header, &payload_hash, 1, &options);
    });
}

#[test]
fn test_get_fee_uses_default_multiplier_when_dst_multiplier_zero() {
    let setup = TestSetup::new(1);
    let fee_lib = setup.env.register(MockFeeLib, ());
    configure_fee_lib(&setup, &fee_lib, 15_000);
    configure_dst_config(&setup, 42, DstConfig { gas: 1, multiplier_bps: 0, floor_margin_usd: 0 });

    let fee = with_contract(&setup, || {
        LzDVN::get_fee(
            &setup.env,
            &new_addr(&setup.env),
            &new_addr(&setup.env),
            42,
            &Bytes::new(&setup.env),
            &BytesN::from_array(&setup.env, &[0; 32]),
            1,
            &Bytes::new(&setup.env),
        )
    });

    assert_eq!(fee, 15_000);
}

#[test]
fn test_get_fee_prefers_dst_multiplier_when_nonzero() {
    let setup = TestSetup::new(1);
    let fee_lib = setup.env.register(MockFeeLib, ());
    configure_fee_lib(&setup, &fee_lib, 15_000);
    configure_dst_config(&setup, 43, DstConfig { gas: 1, multiplier_bps: 9_000, floor_margin_usd: 0 });

    let fee = with_contract(&setup, || {
        LzDVN::get_fee(
            &setup.env,
            &new_addr(&setup.env),
            &new_addr(&setup.env),
            43,
            &Bytes::new(&setup.env),
            &BytesN::from_array(&setup.env, &[0; 32]),
            1,
            &Bytes::new(&setup.env),
        )
    });

    assert_eq!(fee, 9_000);
}

#[test]
fn test_pause_and_setters_happy_paths() {
    let setup = TestSetup::new(1);
    let admin = setup.admins.get(0).unwrap();
    let other = new_addr(&setup.env);

    with_contract(&setup, || {
        LzDVN::set_paused(&setup.env, true);
    });
    with_contract(&setup, || {
        assert!(LzDVN::paused(&setup.env));
    });
    with_contract(&setup, || {
        LzDVN::set_paused(&setup.env, false);
    });
    with_contract(&setup, || {
        assert!(!LzDVN::paused(&setup.env));
    });

    with_contract(&setup, || {
        LzDVN::set_default_multiplier_bps(&setup.env, &admin, 1234);
    });
    with_contract(&setup, || {
        assert_eq!(LzDVN::default_multiplier_bps(&setup.env), 1234);
    });

    with_contract(&setup, || {
        LzDVN::set_deposit_address(&setup.env, &admin, &other);
    });
    with_contract(&setup, || {
        assert_eq!(LzDVN::deposit_address(&setup.env), Some(other));
    });

    let pf = new_addr(&setup.env);
    with_contract(&setup, || {
        LzDVN::set_price_feed(&setup.env, &admin, &pf);
    });
    with_contract(&setup, || {
        assert_eq!(LzDVN::price_feed(&setup.env), Some(pf));
    });

    let opts = Bytes::from_array(&setup.env, &[1, 2, 3]);
    with_contract(&setup, || {
        LzDVN::set_supported_option_types(&setup.env, &admin, 77, &opts);
    });
    with_contract(&setup, || {
        assert_eq!(LzDVN::get_supported_option_types(&setup.env, 77), Some(opts));
    });

    let fee_lib = new_addr(&setup.env);
    with_contract(&setup, || {
        LzDVN::set_worker_fee_lib(&setup.env, &admin, &fee_lib);
    });
    with_contract(&setup, || {
        assert_eq!(LzDVN::worker_fee_lib(&setup.env), Some(fee_lib));
    });
}

#[test]
fn test_acl_and_allowlist_size_reads() {
    let setup = TestSetup::new(1);
    let addr = setup.admins.get(0).unwrap();

    let has_acl = with_contract(&setup, || LzDVN::has_acl(&setup.env, &addr));
    assert!(has_acl);
    let allowlist_size = with_contract(&setup, || LzDVN::allowlist_size(&setup.env));
    assert_eq!(allowlist_size, 0);
}

#[test]
fn test_set_dst_config_auth_verification() {
    let setup = TestSetup::new(1);
    let admin = setup.admins.get(0).unwrap();
    let dst_eid = 100u32;
    let client = DVNClient::new(&setup.env, &setup.contract_id);
    let params = vec![
        &setup.env,
        DstConfigParam { dst_eid, config: DstConfig { gas: 1000, multiplier_bps: 10000, floor_margin_usd: 0 } },
    ];

    client.set_dst_config(&admin, &params);

    let auths = setup.env.auths();
    assert_eq!(auths.len(), 1);
    let (auth_addr, auth_invocation) = &auths[0];
    assert_eq!(auth_addr, &admin);
    match &auth_invocation.function {
        AuthorizedFunction::Contract((contract_id, fn_name, args)) => {
            assert_eq!(contract_id, &setup.contract_id);
            assert_eq!(fn_name, &Symbol::new(&setup.env, "set_dst_config"));
            assert_eq!(args, &(admin.clone(), params.clone()).into_val(&setup.env));
        }
        _ => panic!("Expected Contract auth"),
    }
}

#[test]
fn test_assign_job_auth_verification() {
    let setup = TestSetup::new(1);
    let admin = setup.admins.get(0).unwrap();
    let fee_lib = setup.env.register(MockFeeLib, ());
    let dst_eid = 50u32;
    let deposit_addr = new_addr(&setup.env);
    let send_lib = new_addr(&setup.env);
    let sender = new_addr(&setup.env);
    let packet_header = Bytes::new(&setup.env);
    let payload_hash = BytesN::from_array(&setup.env, &[0u8; 32]);
    let options = Bytes::new(&setup.env);

    configure_fee_lib(&setup, &fee_lib, 10_000);
    configure_dst_config(&setup, dst_eid, DstConfig { gas: 1, multiplier_bps: 10_000, floor_margin_usd: 0 });

    with_contract(&setup, || {
        LzDVN::set_deposit_address(&setup.env, &admin, &deposit_addr);
    });
    with_contract(&setup, || {
        LzDVN::set_supported_message_lib(&setup.env, &send_lib, true);
    });

    let result = setup.env.as_contract(&setup.contract_id, || {
        LzDVN::assign_job(&setup.env, &send_lib, &sender, dst_eid, &packet_header, &payload_hash, 1, &options)
    });

    assert_eq!(result, FeeRecipient { amount: 10_000, to: deposit_addr.clone() });

    let auths = setup.env.auths();
    // send_lib auth + admin auths from previous configuration steps
    assert!(auths.iter().any(|(addr, _)| addr == &send_lib));
}

#[test]
fn test_set_admin_add() {
    let setup = TestSetup::new(1);
    let existing_admin = setup.admins.get(0).unwrap();
    let new_admin = new_addr(&setup.env);

    // Verify new_admin is not an admin initially
    let is_admin = with_contract(&setup, || LzDVN::is_admin(&setup.env, &new_admin));
    assert!(!is_admin);

    // Add new admin by existing admin
    with_contract(&setup, || {
        LzDVN::set_admin_by_admin(&setup.env, &existing_admin, &new_admin, true);
    });

    // Verify new_admin is now an admin
    let is_admin = with_contract(&setup, || LzDVN::is_admin(&setup.env, &new_admin));
    assert!(is_admin);
}

#[test]
fn test_set_admin_remove() {
    let setup = TestSetup::new(1);
    let existing_admin = setup.admins.get(0).unwrap();
    let new_admin = new_addr(&setup.env);

    // Add new admin first
    with_contract(&setup, || {
        LzDVN::set_admin_by_admin(&setup.env, &existing_admin, &new_admin, true);
    });

    // Remove the new admin
    with_contract(&setup, || {
        LzDVN::set_admin_by_admin(&setup.env, &existing_admin, &new_admin, false);
    });

    // Verify new_admin is no longer an admin
    let is_admin = with_contract(&setup, || LzDVN::is_admin(&setup.env, &new_admin));
    assert!(!is_admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #1212)")] // WorkerError::Unauthorized
fn test_set_admin_unauthorized() {
    let setup = TestSetup::new(1);
    let non_admin = new_addr(&setup.env);
    let new_admin = new_addr(&setup.env);

    // Attempt to add admin by non-admin should fail
    with_contract(&setup, || {
        LzDVN::set_admin_by_admin(&setup.env, &non_admin, &new_admin, true);
    });
}

#[test]
fn test_set_admin_remove_last_admin() {
    let setup = TestSetup::new(1);
    let existing_admin = setup.admins.get(0).unwrap();

    // Removing the only admin is now allowed
    with_contract(&setup, || {
        LzDVN::set_admin_by_admin(&setup.env, &existing_admin, &existing_admin, false);
    });

    // Verify admin is no longer an admin
    let is_admin = with_contract(&setup, || LzDVN::is_admin(&setup.env, &existing_admin));
    assert!(!is_admin);
}

#[contract]
struct MockFeeLib;

#[contractimpl]
impl IDvnFeeLib for MockFeeLib {
    fn get_fee(_env: &Env, _dvn: &Address, params: &DvnFeeParams) -> i128 {
        if params.multiplier_bps == 0 {
            params.default_multiplier_bps as i128
        } else {
            params.multiplier_bps as i128
        }
    }

    fn version(_env: &Env) -> (u64, u32) {
        (1, 1)
    }
}
