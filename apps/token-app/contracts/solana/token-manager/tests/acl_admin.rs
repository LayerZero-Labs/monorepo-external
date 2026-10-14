#[path = "support/mod.rs"]
mod support;
use anchor_lang::{error::ErrorCode, AnchorSerialize};
use mollusk_svm_programs_token::token2022;
use solana_account::Account;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use spl_token_2022_interface::{
    error::TokenError, extension::default_account_state::instruction as das, state::AccountState,
};
use support::*;
use token_acl_client::{accounts::MintConfig, instructions as acl};
use token_manager::{errors::TokenManagerError, RoleType};
use token_manager_interface::SignerKind;

#[test]
fn freeze_and_thaw_are_separate_roles_and_do_not_grant_configuration_rights() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    f.ok(&[f.acl(account, owner, false)]);
    for unauthorized in [f.operator, f.keeper] {
        f.fails(
            &[f.admin_freeze(account, true, unauthorized)],
            0,
            ErrorCode::AccountNotInitialized,
        );
    }
    f.ok(&[
        f.grant_role_ix(RoleType::Freezer, f.operator),
        f.admin_freeze(account, true, f.operator),
    ]);
    f.fails(&[f.admin_freeze(account, false, f.operator)], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.grant_role_ix(RoleType::Thawer, f.keeper), f.admin_freeze(account, false, f.keeper)]);
    f.fails(&[f.admin_freeze(account, true, f.keeper)], 0, ErrorCode::AccountNotInitialized);
    assert_eq!(f.token(&account).state, AccountState::Initialized);
    let mut ix = f.acl_permissions_ix(false, false);
    for meta in &mut ix.accounts {
        if meta.pubkey == f.admin {
            meta.pubkey = f.operator;
        }
        if meta.pubkey == role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin) {
            meta.pubkey = role_member(&f.token_manager, RoleType::DefaultAdmin, &f.operator);
        }
    }
    f.fails(&[ix], 0, ErrorCode::AccountNotInitialized);
}

#[test]
fn disabling_permissionless_operations_preserves_role_gated_operations() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    let planned_thaw = f.acl(account, owner, false);
    f.ok(&[f.acl_permissions_ix(false, false)]);
    f.fails(&[planned_thaw], 0, ACL_PERMISSIONLESS_THAW_NOT_ENABLED);
    f.ok(&[f.admin_freeze(account, false, f.admin), f.admin_freeze(account, true, f.admin)]);
    f.ok(&[f.acl_permissions_ix(true, true)]);
    f.ok(&[f.acl(account, owner, false)]);
    assert_eq!(f.token(&account).state, AccountState::Initialized);
}

/// The flags are one configuration, so re-applying the stored values succeeds, as EVM's two-flag
/// `setRateLimitGlobalConfig` does.
#[test]
fn setting_unchanged_acl_permissions_succeeds() {
    let f = Fixture::new(Mode::Acl);
    for (freeze_enabled, thaw_enabled) in [(true, true), (true, false), (true, false)] {
        f.ok(&[f.acl_permissions_ix(freeze_enabled, thaw_enabled)]);
        let config = MintConfig::from_bytes(&f.account(&f.mint_config()).data).unwrap();
        assert_eq!(
            (config.enable_permissionless_freeze, config.enable_permissionless_thaw),
            (freeze_enabled, thaw_enabled)
        );
    }
}

#[test]
fn admin_wrapper_rejects_account_mint_program_config_and_role_substitution() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    let other = Fixture::new(Mode::Acl);
    let other_account = other.create_token(owner);
    let other_thawer = role_member(&other.token_manager, RoleType::Thawer, &other.admin);
    for key in [other.mint, other.token_manager, other.mint_config(), other_account, other_thawer] {
        f.context.account_store.borrow_mut().insert(key, other.account(&key));
    }
    let original = f.account(&account);
    // Token ACL's `InvalidAuthority`: another config's freeze authority is not this root's signer.
    for (from, to, error) in [
        (account, other_account, TokenError::MintMismatch as u32),
        (f.mint, other.mint, ErrorCode::ConstraintHasOne.into()),
        (f.token_manager, other.token_manager, ErrorCode::ConstraintHasOne.into()),
        (f.mint_config(), other.mint_config(), ACL_INVALID_AUTHORITY),
        (token_acl_interface::TOKEN_ACL_ID, token2022::ID, ErrorCode::ConstraintAddress.into()),
        (token2022::ID, token_acl_interface::TOKEN_ACL_ID, ErrorCode::InvalidProgramId.into()),
        (
            role_member(&f.token_manager, RoleType::Thawer, &f.admin),
            other_thawer,
            ErrorCode::ConstraintSeeds.into(),
        ),
    ] {
        let mut ix = f.admin_freeze(account, false, f.admin);
        ix.accounts.iter_mut().find(|meta| meta.pubkey == from).unwrap().pubkey = to;
        f.fails(&[ix], 0, error);
        assert_eq!(f.account(&account), original);
    }
}

#[test]
fn admin_thaw_followed_by_failed_step_rolls_back_native_state() {
    let f = Fixture::new(Mode::Acl);
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    let before = f.account(&account);
    f.fails(
        &[f.admin_freeze(account, false, f.admin), f.admin_freeze(account, true, f.keeper)],
        1,
        ErrorCode::AccountNotInitialized,
    );
    assert_eq!(f.account(&account), before);
}

/// A successor gate takes over through the root that administers the config; nobody else can.
#[test]
fn the_default_admin_hands_the_gate_to_a_successor() {
    let f = Fixture::new(Mode::Acl);
    let successor = Pubkey::new_unique();
    let mut by_keeper = f.acl_gating_program_ix(successor);
    let admin_role = role_member(&f.token_manager, RoleType::DefaultAdmin, &f.admin);
    for meta in &mut by_keeper.accounts {
        if meta.pubkey == f.admin {
            meta.pubkey = f.keeper;
        } else if meta.pubkey == admin_role {
            meta.pubkey = role_member(&f.token_manager, RoleType::DefaultAdmin, &f.keeper);
        }
    }
    f.fails(&[by_keeper], 0, ErrorCode::AccountNotInitialized);
    f.ok(&[f.acl_gating_program_ix(successor)]);
    let config = MintConfig::from_bytes(&f.account(&f.mint_config()).data).unwrap();
    assert_eq!(config.gating_program, successor);
}

/// The manifests are inert until Token ACL names this program as the gate, so a root can stage
/// them before it is the ACL admin, or before any config exists.
#[test]
fn init_acl_stages_manifests_before_the_acl_handoff() {
    let f = Fixture::uninitialized(Mode::Acl);
    f.ok(&[f.init_token_manager_ix(f.admin, f.admin), f.accept_admin_ix(f.admin)]);
    f.ok(&f.policy_ixs());
    f.ok(&[f.init_acl_ix()]);
    f.ok(&[f.create_acl_config_ix()]);
    f.ok(&[f.init_acl_ix()]);
}

/// Token ACL registers any mint with the DefaultAccountState extension, but a thawed default lets
/// every new account skip the thaw gate, so binding refuses it.
#[test]
fn init_acl_rejects_a_mint_whose_default_account_state_is_not_frozen() {
    let f = Fixture::uninitialized(Mode::Acl);
    // Only the native freeze authority may change the default, so before Token ACL takes it.
    f.ok(&[das::update_default_account_state(
        &token2022::ID,
        &f.mint,
        &f.admin,
        &[],
        &AccountState::Initialized,
    )
    .unwrap()]);
    f.ok(&[f.init_token_manager_ix(f.admin, f.admin), f.accept_admin_ix(f.admin)]);
    f.ok(&f.policy_ixs());
    f.ok(&[
        f.create_acl_config_ix(),
        acl::SetAuthorityBuilder::new()
            .authority(f.admin)
            .mint_config(f.mint_config())
            .new_authority(f.acl_signer())
            .instruction(),
    ]);
    f.fails(&[f.init_acl_ix()], 0, TokenManagerError::DefaultAccountStateNotFrozen);
    for manifest in [
        token_acl_interface::get_thaw_extra_account_metas_address(&f.mint, &token_manager::ID),
        token_acl_interface::get_freeze_extra_account_metas_address(&f.mint, &token_manager::ID),
    ] {
        assert_eq!(f.account(&manifest), Account::default());
    }
}

#[test]
fn acl_admin_ops_refuse_another_mints_config_the_acl_signer_administers() {
    let f = Fixture::new(Mode::Acl);
    // Token ACL's toggle and SetAuthority never check the mint, so only the address pin stops this
    // root's admin from reaching another mint's config that happens to name our Acl signer.
    let foreign = Pubkey::new_unique();
    let mut account = f.account(&f.mint_config());
    let mut config = MintConfig::from_bytes(&account.data).unwrap();
    config.mint = Pubkey::new_unique();
    account.data.clear();
    config.serialize(&mut account.data).unwrap();
    f.context.account_store.borrow_mut().insert(foreign, account);
    let redirect = |mut ix: Instruction| {
        ix.accounts
            .iter_mut()
            .filter(|m| m.pubkey == f.mint_config())
            .for_each(|m| m.pubkey = foreign);
        ix
    };
    for ix in
        [f.acl_permissions_ix(false, false), f.set_native_authority_ix(SignerKind::Acl, f.keeper)]
    {
        f.fails(&[redirect(ix)], 0, ErrorCode::ConstraintAddress as u32);
    }
}
