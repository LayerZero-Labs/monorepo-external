use anchor_lang::prelude::*;
use spl_token_2022::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount,
        confidential_transfer_fee::ConfidentialTransferFeeAmount, cpi_guard::CpiGuard,
        immutable_owner::ImmutableOwner, memo_transfer::MemoTransfer,
        non_transferable::NonTransferableAccount, pausable::PausableAccount,
        transfer_fee::TransferFeeAmount, transfer_hook::TransferHookAccount,
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    },
    state::{Account as TokenAccount, AccountState},
};
use token_manager::{errors::TokenManagerError, instructions::acl::gate::validate_empty_account};

fn empty_confidential_account() -> Vec<u8> {
    let mut data = vec![
        0;
        ExtensionType::try_calculate_account_len::<TokenAccount>(&[
            ExtensionType::ConfidentialTransferAccount,
            ExtensionType::ConfidentialTransferFeeAmount,
            ExtensionType::TransferFeeAmount,
        ])
        .unwrap()
    ];
    let mut state =
        StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut data).unwrap();
    state.base.state = AccountState::Frozen;
    state.init_extension::<ConfidentialTransferAccount>(false).unwrap();
    state.init_extension::<ConfidentialTransferFeeAmount>(false).unwrap();
    state.init_extension::<TransferFeeAmount>(false).unwrap();
    state.init_account_type().unwrap();
    state.pack_base();
    data
}

#[test]
fn canonical_empty_confidential_balances_and_fees_are_allowed() {
    validate_empty_account(&empty_confidential_account()).unwrap();
}

#[test]
fn nonzero_base_balance_is_non_empty_regardless_of_extensions() {
    let mut data = empty_confidential_account();
    let mut state = StateWithExtensionsMut::<TokenAccount>::unpack(&mut data).unwrap();
    state.base.amount = 1;
    state.pack_base();
    assert_eq!(
        validate_empty_account(&data).unwrap_err(),
        error!(TokenManagerError::NonEmptyAccount)
    );
}

/// Which fields make an extension non-closable is Token-2022's `closable()`; this pins that the
/// gate consults it for every balance-bearing extension. The nonzero ciphertext bytes are
/// synthetic, not a particular plaintext amount or valid ZK proof.
#[test]
fn each_recognized_balance_extension_precludes_activation_when_nonzero() {
    let balances: [fn(&mut StateWithExtensionsMut<TokenAccount>); 3] = [
        |state| {
            state.get_extension_mut::<TransferFeeAmount>().unwrap().withheld_amount = 1.into();
        },
        |state| {
            state
                .get_extension_mut::<ConfidentialTransferAccount>()
                .unwrap()
                .available_balance
                .0[0] = 1;
        },
        |state| {
            state
                .get_extension_mut::<ConfidentialTransferFeeAmount>()
                .unwrap()
                .withheld_amount
                .0[0] = 1;
        },
    ];
    for fund in balances {
        let mut data = empty_confidential_account();
        fund(&mut StateWithExtensionsMut::<TokenAccount>::unpack(&mut data).unwrap());
        assert_eq!(
            validate_empty_account(&data).unwrap_err(),
            error!(TokenManagerError::NonEmptyAccount)
        );
    }
}

#[test]
fn empty_confidential_state_does_not_bypass_native_account_rejection() {
    let mut data = empty_confidential_account();
    let mut state = StateWithExtensionsMut::<TokenAccount>::unpack(&mut data).unwrap();
    state.base.is_native = Some(1).into();
    state.pack_base();
    let error = validate_empty_account(&data).unwrap_err();
    assert_eq!(error, error!(TokenManagerError::UnsupportedExtension));
}

#[test]
fn unknown_account_extensions_still_fail_closed() {
    let mut data = empty_confidential_account();
    data[166..168].copy_from_slice(&65000u16.to_le_bytes());
    assert!(validate_empty_account(&data).is_err());
}

#[test]
fn recognized_non_balance_extensions_are_allowed() {
    // Parser fixture, not a claim that every mint extension combination is supported.
    let mut data = vec![
        0;
        ExtensionType::try_calculate_account_len::<TokenAccount>(&[
            ExtensionType::ImmutableOwner,
            ExtensionType::MemoTransfer,
            ExtensionType::CpiGuard,
            ExtensionType::NonTransferableAccount,
            ExtensionType::TransferHookAccount,
            ExtensionType::PausableAccount,
        ])
        .unwrap()
    ];
    let mut state =
        StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut data).unwrap();
    state.base.state = AccountState::Frozen;
    state.init_extension::<ImmutableOwner>(false).unwrap();
    state.init_extension::<MemoTransfer>(false).unwrap();
    state.init_extension::<CpiGuard>(false).unwrap();
    state.init_extension::<NonTransferableAccount>(false).unwrap();
    state.init_extension::<TransferHookAccount>(false).unwrap();
    state.init_extension::<PausableAccount>(false).unwrap();
    state.init_account_type().unwrap();
    state.pack_base();

    validate_empty_account(&data).unwrap();
}

#[test]
fn ignored_extension_with_invalid_tlv_length_still_fails_closed() {
    let mut data = empty_confidential_account();
    // First TLV starts at byte 166; a recognized, ignored type must not let its
    // declared value extend beyond the account data.
    data[166..168].copy_from_slice(&(ExtensionType::MemoTransfer as u16).to_le_bytes());
    data[168..170].copy_from_slice(&u16::MAX.to_le_bytes());
    assert!(validate_empty_account(&data).is_err());
}
