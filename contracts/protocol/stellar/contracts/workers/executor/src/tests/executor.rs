use super::setup::TestSetup;
use crate::errors::ExecutorError;
use crate::events::{DstConfigSet, NativeDropApplied};
use endpoint_v2::{FeeRecipient, Origin};
use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN, IntoVal};
use utils::testing_utils::assert_contains_event;
use worker::WorkerError;

// =============================================================================
// Construction
// =============================================================================

#[test]
fn test_constructor_sets_endpoint_and_worker_config() {
    let setup = TestSetup::new();

    assert_eq!(setup.client.owner(), Some(setup.owner.clone()));
    assert_eq!(setup.client.admins(), setup.admins);
    assert_eq!(setup.client.is_admin(&setup.admins.get(0).unwrap()), true);
    assert_eq!(setup.client.is_supported_message_lib(&setup.send_lib), true);
    assert_eq!(setup.client.message_libs(), vec![&setup.env, setup.send_lib.clone()]);

    assert_eq!(setup.client.endpoint(), setup.endpoint);
    assert_eq!(setup.client.deposit_address(), Some(setup.deposit_address.clone()));
    assert_eq!(setup.client.price_feed(), Some(setup.price_feed.clone()));
    assert_eq!(setup.client.worker_fee_lib(), Some(setup.worker_fee_lib.clone()));
    assert_eq!(setup.client.default_multiplier_bps(), setup.default_multiplier_bps);
    assert_eq!(setup.client.paused(), false);
}

// =============================================================================
// Admin functions (withdraw + admin management)
// =============================================================================

#[test]
fn test_withdraw_token_transfers_from_contract() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();
    let to = Address::generate(&setup.env);

    // Mint native token to the executor contract so it can withdraw it.
    setup.mint_native(&setup.contract_id, 100);
    let before_contract = setup.balance_native(&setup.contract_id);
    let before_to = setup.balance_native(&to);

    setup.mock_auth(&admin, "withdraw_token", (&admin, &setup.native_token, &to, 40i128));
    setup.client.withdraw_token(&admin, &setup.native_token, &to, &40);

    assert_eq!(setup.balance_native(&setup.contract_id), before_contract - 40);
    assert_eq!(setup.balance_native(&to), before_to + 40);
}

#[test]
fn test_withdraw_token_requires_admin() {
    let setup = TestSetup::new();

    let non_admin = Address::generate(&setup.env);
    let to = Address::generate(&setup.env);
    setup.mock_auth(&non_admin, "withdraw_token", (&non_admin, &setup.native_token, &to, 1i128));
    assert_eq!(
        setup.client.try_withdraw_token(&non_admin, &setup.native_token, &to, &1).unwrap_err().unwrap(),
        WorkerError::Unauthorized.into()
    );
}

#[test]
fn test_set_admin_add_and_remove() {
    let setup = TestSetup::new();
    let new_admin = Address::generate(&setup.env);

    // Add new admin
    setup.mock_owner_auth("set_admin", (&new_admin, true));
    setup.client.set_admin(&new_admin, &true);
    assert_eq!(setup.client.is_admin(&new_admin), true);

    // Remove that admin
    setup.mock_owner_auth("set_admin", (&new_admin, false));
    setup.client.set_admin(&new_admin, &false);
    assert_eq!(setup.client.is_admin(&new_admin), false);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_admin_requires_owner_auth() {
    let setup = TestSetup::new();
    let new_admin = Address::generate(&setup.env);

    // No mock_auths -> owner.require_auth() must fail.
    setup.client.set_admin(&new_admin, &true);
}

// =============================================================================
// IExecutor methods
// =============================================================================

#[test]
fn test_set_dst_config_and_dst_config_view() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();

    let cfg_a = setup.new_dst_config(0);
    let cfg_b = setup.new_dst_config(12_000);
    let params = vec![
        &setup.env,
        crate::SetDstConfigParam { dst_eid: 1, dst_config: cfg_a.clone() },
        crate::SetDstConfigParam { dst_eid: 2, dst_config: cfg_b.clone() },
    ];

    setup.mock_auth(&admin, "set_dst_config", (&admin, &params));
    setup.client.set_dst_config(&admin, &params);

    assert_contains_event(&setup.env, &setup.contract_id, DstConfigSet { params: params.clone() });
    assert_eq!(setup.client.dst_config(&1), Some(cfg_a));
    assert_eq!(setup.client.dst_config(&2), Some(cfg_b));
    assert_eq!(setup.client.dst_config(&999), None);
}

#[test]
fn test_set_dst_config_requires_admin() {
    let setup = TestSetup::new();
    let non_admin = Address::generate(&setup.env);
    let cfg = setup.new_dst_config(0);
    let params = vec![&setup.env, crate::SetDstConfigParam { dst_eid: 1, dst_config: cfg }];

    setup.mock_auth(&non_admin, "set_dst_config", (&non_admin, &params));
    assert_eq!(
        setup.client.try_set_dst_config(&non_admin, &params).unwrap_err().unwrap(),
        WorkerError::Unauthorized.into()
    );
}

#[test]
fn test_native_drop_emits_success_vector_and_requires_admin() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();

    // Fund admin so at least one transfer can succeed.
    setup.mint_native(&admin, 100);
    let admin_before = setup.balance_native(&admin);

    let receiver_a = Address::generate(&setup.env);
    let receiver_b = Address::generate(&setup.env);
    let receivers = vec![&setup.env, receiver_a.clone(), receiver_b.clone()];
    let amounts = vec![&setup.env, 10i128, 20i128];
    let params = setup.native_drop_params(&receivers, &amounts);
    let receiver_a_before = setup.balance_native(&receiver_a);
    let receiver_b_before = setup.balance_native(&receiver_b);
    let origin = Origin { src_eid: 1, sender: BytesN::from_array(&setup.env, &[7u8; 32]), nonce: 1 };
    let oapp = Address::generate(&setup.env);

    // Authorize admin calling native_drop, and authorize ONLY the first token transfer sub-invoke.
    setup.env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &admin,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &setup.contract_id,
            fn_name: "native_drop",
            args: (&admin, &origin, 2u32, &oapp, &params).into_val(&setup.env),
            sub_invokes: &[
                soroban_sdk::testutils::MockAuthInvoke {
                    contract: &setup.native_token,
                    fn_name: "transfer",
                    args: (&admin, &receiver_a, &10i128).into_val(&setup.env),
                    sub_invokes: &[],
                },
                // receiver_b transfer intentionally NOT authorized -> should fail
            ],
        },
    }]);

    setup.client.native_drop(&admin, &origin, &2, &oapp, &params);

    // Validate event: first succeeds, second fails.
    assert_contains_event(
        &setup.env,
        &setup.contract_id,
        NativeDropApplied {
            origin: origin.clone(),
            dst_eid: 2,
            oapp: oapp.clone(),
            native_drop_params: params.clone(),
            success: vec![&setup.env, true, false],
        },
    );

    // Balance assertions:
    // - only the authorized transfer (receiver_a) should have moved funds
    assert_eq!(setup.balance_native(&receiver_a), receiver_a_before + 10);
    assert_eq!(setup.balance_native(&receiver_b), receiver_b_before);
    assert_eq!(setup.balance_native(&admin), admin_before - 10);
}

#[test]
fn test_native_drop_requires_admin() {
    let setup = TestSetup::new();
    let origin = Origin { src_eid: 1, sender: BytesN::from_array(&setup.env, &[7u8; 32]), nonce: 1 };
    let oapp = Address::generate(&setup.env);
    let receiver_a = Address::generate(&setup.env);
    let receiver_b = Address::generate(&setup.env);
    let receivers = vec![&setup.env, receiver_a.clone(), receiver_b.clone()];
    let amounts = vec![&setup.env, 10i128, 20i128];
    let params = setup.native_drop_params(&receivers, &amounts);

    // Requires admin membership (auth provided but non-admin)
    let non_admin = Address::generate(&setup.env);
    setup.mock_auth(&non_admin, "native_drop", (&non_admin, &origin, 2u32, &oapp, &params));
    assert_eq!(
        setup.client.try_native_drop(&non_admin, &origin, &2, &oapp, &params).unwrap_err().unwrap(),
        WorkerError::Unauthorized.into()
    );
}

// =============================================================================
// Send-flow methods
// =============================================================================

#[test]
fn test_assign_job_success_returns_fee_recipient() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();

    // Need dst config for fee calc.
    let cfg = setup.new_dst_config(12_000);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[9, 9]);

    // Success: send_lib must auth.
    setup.env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &setup.send_lib,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &setup.contract_id,
            fn_name: "assign_job",
            args: (&setup.send_lib, &sender, 1u32, 7u32, &options).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    let fr: FeeRecipient = setup.client.assign_job(&setup.send_lib, &sender, &1, &7, &options);
    assert_eq!(fr.to, setup.deposit_address);
    let expected_fee = 7i128
        + cfg.lz_receive_base_gas as i128
        + cfg.lz_compose_base_gas as i128
        + cfg.multiplier_bps as i128
        + (cfg.floor_margin_usd % 10_000) as i128
        + (cfg.native_cap % 10_000) as i128;
    assert_eq!(fr.amount, expected_fee);
}

#[test]
fn test_assign_job_rejects_unsupported_message_lib() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();

    // Need dst config for fee calc.
    let cfg = setup.new_dst_config(12_000);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[9, 9]);

    // Error: unsupported message lib (still must auth)
    let unsupported = Address::generate(&setup.env);
    setup.env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &unsupported,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &setup.contract_id,
            fn_name: "assign_job",
            args: (&unsupported, &sender, 1u32, 7u32, &options).into_val(&setup.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        setup.client.try_assign_job(&unsupported, &sender, &1, &7, &options).unwrap_err().unwrap(),
        WorkerError::UnsupportedMessageLib.into()
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_assign_job_requires_send_lib_auth() {
    let setup = TestSetup::new();
    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[9, 9]);

    // No mock_auths for send_lib.require_auth()
    let _ = setup.client.assign_job(&setup.send_lib, &sender, &1, &7, &options);
}

#[test]
fn test_get_fee_success_includes_default_multiplier_when_dst_multiplier_is_zero() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();

    // Configure dst eid 1 so get_fee succeeds.
    let cfg = setup.new_dst_config(0);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[1, 2, 3]);

    // Success (multiplier_bps is 0 so fee uses default_multiplier_bps too).
    let fee = setup.client.get_fee(&setup.send_lib, &sender, &1, &7, &options);
    let expected_fee = 7i128
        + cfg.lz_receive_base_gas as i128
        + cfg.lz_compose_base_gas as i128
        + cfg.multiplier_bps as i128
        + (cfg.floor_margin_usd % 10_000) as i128
        + (cfg.native_cap % 10_000) as i128
        + setup.default_multiplier_bps as i128;
    assert_eq!(fee, expected_fee);
}

#[test]
fn test_get_fee_success_when_multiplier_is_nonzero() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();

    let cfg = setup.new_dst_config(12_000);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[1, 2, 3]);

    let fee = setup.client.get_fee(&setup.send_lib, &sender, &1, &7, &options);
    let expected_fee = 7i128
        + cfg.lz_receive_base_gas as i128
        + cfg.lz_compose_base_gas as i128
        + cfg.multiplier_bps as i128
        + (cfg.floor_margin_usd % 10_000) as i128
        + (cfg.native_cap % 10_000) as i128;
    assert_eq!(fee, expected_fee);
}

#[test]
fn test_get_fee_rejects_when_paused() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();
    let cfg = setup.new_dst_config(0);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[1, 2, 3]);

    setup.mock_owner_auth("set_paused", (true,));
    setup.client.set_paused(&true);
    assert_eq!(
        setup.client.try_get_fee(&setup.send_lib, &sender, &1, &7, &options).unwrap_err().unwrap(),
        WorkerError::WorkerIsPaused.into()
    );
}

#[test]
fn test_get_fee_rejects_when_sender_not_allowed() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();
    let cfg = setup.new_dst_config(0);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[1, 2, 3]);

    let allowlisted = Address::generate(&setup.env);
    setup.mock_owner_auth("set_allowlist", (&allowlisted, true));
    setup.client.set_allowlist(&allowlisted, &true);
    assert_eq!(
        setup.client.try_get_fee(&setup.send_lib, &sender, &1, &7, &options).unwrap_err().unwrap(),
        WorkerError::NotAllowed.into()
    );
}

#[test]
fn test_get_fee_rejects_when_sender_is_denylisted_even_if_allowlisted() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();
    let cfg = setup.new_dst_config(0);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[1, 2, 3]);

    // Put sender on allowlist, then also on denylist. Denylist should take precedence.
    setup.mock_owner_auth("set_allowlist", (&sender, true));
    setup.client.set_allowlist(&sender, &true);

    setup.mock_owner_auth("set_denylist", (&sender, true));
    setup.client.set_denylist(&sender, &true);

    assert_eq!(
        setup.client.try_get_fee(&setup.send_lib, &sender, &1, &7, &options).unwrap_err().unwrap(),
        WorkerError::NotAllowed.into()
    );
}

#[test]
fn test_get_fee_rejects_unsupported_eid() {
    let setup = TestSetup::new();
    let admin = setup.admins.get(0).unwrap();
    let cfg = setup.new_dst_config(0);
    setup.set_dst_config_one(&admin, 1, &cfg);

    let sender = Address::generate(&setup.env);
    let options = Bytes::from_slice(&setup.env, &[1, 2, 3]);

    setup.mock_owner_auth("set_allowlist", (&sender, true));
    setup.client.set_allowlist(&sender, &true);
    assert_eq!(
        setup.client.try_get_fee(&setup.send_lib, &sender, &999, &7, &options).unwrap_err().unwrap(),
        ExecutorError::EidNotSupported.into()
    );
}
