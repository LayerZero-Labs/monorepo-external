use crate::{CreditRedirectConfig, OFTError};
use anchor_lang::prelude::*;

/// The redirect escrow in use: the configured one, which must then be supplied, or none when
/// redirect is disabled. Shared by the planner and `lz_receive` so both admit the same account.
pub fn resolve_redirect_escrow<'info>(
    config: Option<CreditRedirectConfig>,
    supplied: Option<&UncheckedAccount<'info>>,
) -> Result<Option<AccountInfo<'info>>> {
    match (config, supplied) {
        (None, None) => Ok(None),
        (Some(config), Some(escrow)) if escrow.key() == config.redirect_escrow => {
            Ok(Some(escrow.to_account_info()))
        },
        _ => err!(OFTError::InvalidRedirectEscrow),
    }
}

/// The amount reported as received, to the compose message and events: zero when the credit was
/// redirected. The planner derives each compose group's accounts from it, so both sides use this.
pub fn delivered_amount(redirected: bool, amount_ld: u64) -> u64 {
    if redirected {
        0
    } else {
        amount_ld
    }
}
