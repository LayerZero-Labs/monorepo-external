//! Credit-redirect configuration. Receive's redirect decision is covered by `oft_pubkey_policy.rs`
//! and `tests/integration`.
mod oft;

use anchor_lang::error::ErrorCode;
use console_oft::{errors::OFTError, events::CreditRedirectConfigSet, state::CreditRedirectConfig};
use oft::helpers::*;
use solana_pubkey::Pubkey;
use spl_token_2022::state::AccountState;

fn escrow(f: &OftFixture, mint: Pubkey, state: AccountState) -> Pubkey {
    let key = Pubkey::new_unique();
    f.insert(key, token_account(&mint, &f.admin, state));
    key
}

#[test]
fn redirect_escrow_can_be_set_replaced_and_disabled() {
    let f = fixture();
    let oft_store = to_program_pubkey(&f.oft_store);
    for escrow in [
        Some(escrow(&f, f.token_mint, AccountState::Initialized)),
        Some(escrow(&f, f.token_mint, AccountState::Initialized)),
        None,
    ] {
        let config = escrow
            .map(|escrow| CreditRedirectConfig { redirect_escrow: to_program_pubkey(&escrow) });
        let result = f.ok(&set_credit_redirect_config_ix(&f, f.admin, escrow));
        assert_only_event(&result, CreditRedirectConfigSet { oft_store, config });
        assert_eq!(f.store().credit_redirect_config, config);
    }
}

/// The escrow must be able to receive this mint when a redirect happens, and must not be owned by
/// the OFT, which could never move a credit out of it (its own escrow included).
#[test]
fn redirect_escrow_must_be_an_unfrozen_account_of_the_mint_the_oft_does_not_own() {
    let f = fixture();
    let other_mint = Pubkey::new_unique();
    f.insert(other_mint, token_mint_account(TOKEN_DECIMALS));
    let oft_owned = Pubkey::new_unique();
    f.insert(oft_owned, token_account(&f.token_mint, &f.oft_store, AccountState::Initialized));
    for (escrow, error) in [
        (escrow(&f, other_mint, AccountState::Initialized), ErrorCode::ConstraintTokenMint.into()),
        (escrow(&f, f.token_mint, AccountState::Frozen), u32::from(OFTError::RedirectEscrowFrozen)),
        (f.oft_escrow, OFTError::InvalidRedirectEscrow.into()),
        (oft_owned, OFTError::InvalidRedirectEscrow.into()),
    ] {
        assert_eq!(
            f.fails(&set_credit_redirect_config_ix(&f, f.admin, Some(escrow))),
            program_failure(error)
        );
        assert_eq!(f.store().credit_redirect_config, None);
    }
}
