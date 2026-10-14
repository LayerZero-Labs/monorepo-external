#[path = "support/mod.rs"]
mod support;

use solana_pubkey::Pubkey;
use spl_token_2022_interface::{
    error::TokenError,
    extension::{
        confidential_transfer::ConfidentialTransferAccount,
        confidential_transfer_fee::ConfidentialTransferFeeAmount, transfer_fee::TransferFeeAmount,
        BaseStateWithExtensions, BaseStateWithExtensionsMut, ExtensionType, StateWithExtensions,
        StateWithExtensionsMut,
    },
    state::{Account as TokenAccount, AccountState},
};
use support::*;
use token_manager::errors::TokenManagerError;

#[test]
fn repeating_manifest_initialization_preserves_policy_and_token_authorities() {
    let f = Fixture::new(Mode::AclHook);
    let subject = Pubkey::new_unique();
    f.block(subject, true);
    f.ok(&[f.set_mode_ix(pubkey_policy_interface::PubkeyPolicyMode::Whitelist)]);
    let addresses = [f.token_manager, f.record(&subject), f.mint, f.mint_config()];
    let before: Vec<_> = addresses.iter().map(|key| f.account(key).data).collect();
    f.ok(&[f.init_acl_ix(), f.init_transfer_hook_ix()]);
    for (key, expected) in addresses.iter().zip(before) {
        assert_eq!(f.account(key).data, expected);
    }
}

#[test]
fn withheld_fees_make_a_zero_base_balance_ineligible_for_permissionless_thaw() {
    let f = Fixture::new(Mode::AclFees);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    let sink = f.create_token(alice);
    f.ok(&[f.acl(source, alice, false), f.acl(destination, bob, false), f.acl(sink, alice, false)]);
    f.mint_to(source, 100);
    f.ok(&[f.transfer(source, destination, alice, 100)]);
    assert_eq!(f.token(&destination).amount, 99);
    f.ok(&[f.transfer(destination, sink, bob, 99)]);
    assert_eq!(f.token(&destination).amount, 0);
    let data = f.account(&destination).data;
    let token = StateWithExtensions::<TokenAccount>::unpack(&data).unwrap();
    assert_eq!(u64::from(token.get_extension::<TransferFeeAmount>().unwrap().withheld_amount), 1);
    f.ok(&[f.admin_freeze(destination, true, f.admin)]);
    f.fails(&[f.acl(destination, bob, false)], 0, TokenManagerError::NonEmptyAccount);
    f.ok(&[f.admin_freeze(destination, false, f.admin)]);
}

/// The gate reads only the token account, never the mint's extensions, so one confidential mint
/// stands for the rest.
#[test]
fn confidential_mint_capabilities_allow_ordinary_empty_account_activation() {
    let f = Fixture::new(Mode::AclConfidentialFees);
    let owner = Pubkey::new_unique();
    let account = f.create_token(owner);
    assert_eq!(f.token(&account).state, AccountState::Frozen);
    let data = f.account(&account).data;
    assert!(StateWithExtensions::<TokenAccount>::unpack(&data)
        .unwrap()
        .get_extension::<ConfidentialTransferAccount>()
        .is_err());
    f.ok(&[f.acl(account, owner, false)]);
    assert_eq!(f.token(&account).state, AccountState::Initialized);
}

/// Seed typed confidential account state for gate boundary tests. These exercise
/// real SBF ACL/manager/thaw execution, not confidential proof generation/transfers.
fn seed_confidential_account(f: &Fixture, owner: Pubkey) -> Pubkey {
    let address = f.create_token(owner);
    let mut account = f.account(&address);
    let base = f.token(&address);
    account.data = vec![
        0;
        ExtensionType::try_calculate_account_len::<TokenAccount>(&[
            ExtensionType::TransferFeeAmount,
            ExtensionType::ConfidentialTransferAccount,
            ExtensionType::ConfidentialTransferFeeAmount,
        ])
        .unwrap()
    ];
    let mut state =
        StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut account.data).unwrap();
    state.base = base;
    state.init_extension::<TransferFeeAmount>(false).unwrap();
    state.init_extension::<ConfidentialTransferAccount>(false).unwrap();
    state.init_extension::<ConfidentialTransferFeeAmount>(false).unwrap();
    state.init_account_type().unwrap();
    state.pack_base();
    account.lamports = f.context.mollusk.sysvars.rent.minimum_balance(account.data.len());
    f.context.account_store.borrow_mut().insert(address, account);
    address
}

#[test]
fn canonical_empty_confidential_account_can_thaw_but_still_obeys_policy() {
    let f = Fixture::new(Mode::AclConfidentialFees);
    let owner = Pubkey::new_unique();
    let account = seed_confidential_account(&f, owner);
    f.block(owner, true);
    f.fails(&[f.acl(account, owner, false)], 0, pubkey_policy_interface::PolicyError::Blocked);
    f.block(owner, false);
    f.ok(&[f.acl(account, owner, false)]);
    assert_eq!(f.token(&account).state, AccountState::Initialized);
}

/// One representative balance; `programs/token_manager/tests/permissionless.rs` covers each
/// balance-bearing extension.
#[test]
fn noncanonical_confidential_balances_require_administrative_thaw() {
    let f = Fixture::new(Mode::AclConfidentialFees);
    let owner = Pubkey::new_unique();
    let address = seed_confidential_account(&f, owner);
    let mut account = f.account(&address);
    StateWithExtensionsMut::<TokenAccount>::unpack(&mut account.data)
        .unwrap()
        .get_extension_mut::<ConfidentialTransferAccount>()
        .unwrap()
        .available_balance
        .0[0] = 1;
    f.context.account_store.borrow_mut().insert(address, account.clone());
    f.fails(&[f.acl(address, owner, false)], 0, TokenManagerError::NonEmptyAccount);
    assert_eq!(f.account(&address), account);
    f.ok(&[f.admin_freeze(address, false, f.admin)]);
    assert_eq!(f.token(&address).state, AccountState::Initialized);
}

/// The Permanent Delegate here is a wallet composing role-gated thaw, transfer and refreeze;
/// `pd_recover` itself is covered in `permanent_delegate.rs`.
#[test]
fn combined_acl_and_hook_share_live_policy_and_exempt_the_permanent_delegate() {
    let f = Fixture::new(Mode::AclHook);
    let alice = Pubkey::new_unique();
    let bob = Pubkey::new_unique();
    let source = f.create_token(alice);
    let destination = f.create_token(bob);
    f.ok(&[f.acl(source, alice, false), f.acl(destination, bob, false)]);
    f.mint_to(source, 100);
    f.block(alice, true);
    f.fails(
        &[f.transfer(source, destination, alice, 1)],
        0,
        pubkey_policy_interface::PolicyError::Blocked,
    );
    // Source holds a balance, so sealing it is the Freezer role's call, not a permissionless one.
    f.fails(&[f.acl(source, alice, true)], 0, TokenManagerError::NonEmptyAccount);
    f.ok(&[f.admin_freeze(source, true, f.admin)]);
    let before = f.account(&source);
    f.fails(
        &[
            f.admin_freeze(source, false, f.admin),
            f.transfer(source, destination, f.admin, 101),
            f.admin_freeze(source, true, f.admin),
        ],
        1,
        TokenError::InsufficientFunds as u32,
    );
    assert_eq!(f.account(&source), before);
    f.ok(&[
        f.admin_freeze(source, false, f.admin),
        f.transfer(source, destination, f.admin, 10),
        f.admin_freeze(source, true, f.admin),
    ]);
    assert_eq!(f.token(&source).state, AccountState::Frozen);
    assert_eq!(f.token(&source).amount, 90);
    assert_eq!(f.token(&destination).amount, 10);
}
