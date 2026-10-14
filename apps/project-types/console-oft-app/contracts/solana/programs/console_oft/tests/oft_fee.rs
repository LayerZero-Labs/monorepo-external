mod oft;

use anchor_lang::{error::ErrorCode, InstructionData};
use console_oft::{
    errors::OFTError,
    events::{DefaultFeeBpsSet, FeeBpsSet, FeeDepositSet},
};
use oft::helpers::*;
use solana_pubkey::Pubkey;
use spl_token_2022::state::AccountState;

const ID: u128 = DST_EID as u128;

#[test]
fn fee_above_one_hundred_percent_is_rejected() {
    let f = fixture();
    for ix in
        [set_default_fee_bps_ix(&f, f.admin, 10_001), set_fee_bps_ix(&f, f.admin, ID, Some(10_001))]
    {
        assert_eq!(f.fails(&ix), program_failure(OFTError::InvalidFee));
    }
    f.ok(&set_default_fee_bps_ix(&f, f.admin, 10_000));
    f.ok(&set_fee_bps_ix(&f, f.admin, ID, Some(10_000)));
}

#[test]
fn per_eid_fee_overrides_the_default_until_removed() {
    let f = fixture();
    let oft_store = to_program_pubkey(&f.oft_store);
    let fee_of_10k = |f: &OftFixture| f.view::<u64>(&get_fee_ix(f, ID, 10_000));

    let result = f.ok(&set_default_fee_bps_ix(&f, f.admin, 25));
    assert_only_event(&result, DefaultFeeBpsSet { oft_store, fee_bps: 25 });
    assert_eq!(fee_of_10k(&f), 25);

    let result = f.ok(&set_fee_bps_ix(&f, f.admin, ID, Some(50)));
    assert_only_event(&result, FeeBpsSet { oft_store, id: ID, fee_bps: Some(50) });
    assert_eq!(fee_of_10k(&f), 50);
    assert_eq!(f.view::<u64>(&get_fee_ix(&f, ID + 1, 10_000)), 25, "other EIDs keep the default");

    let result = f.ok(&set_fee_bps_ix(&f, f.admin, ID, None));
    assert_only_event(&result, FeeBpsSet { oft_store, id: ID, fee_bps: None });
    assert!(f.is_closed(&fee_config_pda(&f.oft_store, ID)));
    assert_eq!(fee_of_10k(&f), 25);
}

#[test]
fn fee_deposit_must_be_the_named_unfrozen_account_of_the_oft_mint() {
    let f = fixture();
    let frozen = Pubkey::new_unique();
    f.insert(frozen, token_account(&f.token_mint, &f.admin, AccountState::Frozen));
    let other_mint = Pubkey::new_unique();
    f.insert(other_mint, token_mint_account(TOKEN_DECIMALS));
    let foreign = Pubkey::new_unique();
    f.insert(foreign, token_account(&other_mint, &f.admin, AccountState::Initialized));
    let replacement = Pubkey::new_unique();
    f.insert(replacement, token_account(&f.token_mint, &f.user, AccountState::Initialized));
    // Fees sent to an account the OFT owns could never be swept.
    let oft_owned = Pubkey::new_unique();
    f.insert(oft_owned, token_account(&f.token_mint, &f.oft_store, AccountState::Initialized));

    let mut misnamed = set_fee_deposit_ix(&f, f.admin, replacement);
    misnamed.data =
        console_oft::instruction::SetFeeDeposit { fee_deposit: to_program_pubkey(&frozen) }.data();
    for (ix, error) in [
        (misnamed, program_failure(OFTError::InvalidFeeDeposit)),
        (set_fee_deposit_ix(&f, f.admin, frozen), program_failure(OFTError::FeeDepositFrozen)),
        (set_fee_deposit_ix(&f, f.admin, foreign), program_failure(ErrorCode::ConstraintTokenMint)),
        (
            set_fee_deposit_ix(&f, f.admin, f.oft_escrow),
            program_failure(OFTError::InvalidFeeDeposit),
        ),
        (set_fee_deposit_ix(&f, f.admin, oft_owned), program_failure(OFTError::InvalidFeeDeposit)),
    ] {
        assert_eq!(f.fails(&ix), error);
        assert_eq!(f.store().fee_deposit, to_program_pubkey(&f.fee_deposit));
    }

    let result = f.ok(&set_fee_deposit_ix(&f, f.admin, replacement));
    assert_only_event(
        &result,
        FeeDepositSet {
            oft_store: to_program_pubkey(&f.oft_store),
            fee_deposit: to_program_pubkey(&replacement),
        },
    );
    assert_eq!(f.store().fee_deposit, to_program_pubkey(&replacement));
}
