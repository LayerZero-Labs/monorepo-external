//! `lz_receive`'s remaining accounts, as planned by `lz_receive_types_v3`:
//!
//! ```text
//! without redirect: [clear][gate][recipient hooks][recipient compose]
//! with redirect:    [clear][gate][recipient hooks][redirect hooks][recipient compose][redirect compose]
//! ```
//!
//! The gate group is the extra accounts the Token ACL gate's thaw manifest names, empty unless the
//! recipient may need a thaw. Hook groups are empty when the mint has no hook; compose groups are
//! empty when the message has no compose payload. With redirect configured, both destinations are
//! planned because execution chooses between them from live state. Their groups differ: hook extras
//! are resolved against the destination, and the redirect compose message carries a zero amount,
//! which changes its composed-message PDA. Both hook groups are validated whichever destination is
//! chosen.

use crate::{MintTransferHook, OFTError, TransferHookAccounts};
use anchor_lang::prelude::*;
use oapp::endpoint_cpi::{CLEAR_MIN_ACCOUNTS_LEN, SEND_COMPOSE_MIN_ACCOUNTS_LEN};

/// One credit destination's accounts: its transfer-hook group and its send-compose group.
pub struct CreditCandidate<'a, 'info> {
    pub hooks: TransferHookAccounts<'a, 'info>,
    pub compose: &'a [AccountInfo<'info>],
}

pub struct ReceiveAccounts<'a, 'info> {
    pub clear: &'a [AccountInfo<'info>],
    recipient: CreditCandidate<'a, 'info>,
    redirect: Option<CreditCandidate<'a, 'info>>,
}

impl<'a, 'info> ReceiveAccounts<'a, 'info> {
    /// The gate group alone, `gate_extras` long
    /// ([`thaw_extra_count`](token_manager_interface::acl::thaw_extra_count)), so a thaw can run
    /// before the rest is parsed.
    pub fn gate(
        accounts: &'a [AccountInfo<'info>],
        gate_extras: usize,
    ) -> Result<&'a [AccountInfo<'info>]> {
        accounts
            .get(CLEAR_MIN_ACCOUNTS_LEN..CLEAR_MIN_ACCOUNTS_LEN + gate_extras)
            .ok_or(error!(OFTError::InsufficientRemainingAccounts))
    }

    /// Everything but the gate group, which is skipped; see [`Self::gate`].
    pub fn parse(
        mint: &MintTransferHook,
        accounts: &'a [AccountInfo<'info>],
        gate_extras: usize,
        has_compose: bool,
        redirect_enabled: bool,
    ) -> Result<Self> {
        let (clear, rest) = accounts
            .split_at_checked(CLEAR_MIN_ACCOUNTS_LEN)
            .ok_or(OFTError::InsufficientRemainingAccounts)?;
        let rest = rest.get(gate_extras..).ok_or(OFTError::InsufficientRemainingAccounts)?;

        let candidates = if redirect_enabled { 2 } else { 1 };
        let compose_len = if has_compose { SEND_COMPOSE_MIN_ACCOUNTS_LEN } else { 0 };
        let hooks_len = rest
            .len()
            .checked_sub(compose_len * candidates)
            .ok_or(OFTError::InsufficientRemainingAccounts)?;
        let (hooks, compose) = rest.split_at(hooks_len);

        if !redirect_enabled {
            return Ok(Self {
                clear,
                recipient: CreditCandidate {
                    hooks: TransferHookAccounts::parse_exact(mint, hooks)?,
                    compose,
                },
                redirect: None,
            });
        }

        let (recipient_hooks, redirect_hooks) = TransferHookAccounts::take_prefix(mint, hooks)?;
        let (recipient_compose, redirect_compose) = compose.split_at(compose_len);
        Ok(Self {
            clear,
            recipient: CreditCandidate { hooks: recipient_hooks, compose: recipient_compose },
            redirect: Some(CreditCandidate {
                hooks: TransferHookAccounts::parse_exact(mint, redirect_hooks)?,
                compose: redirect_compose,
            }),
        })
    }

    /// The accounts for the chosen destination. Redirecting requires the planned redirect route.
    pub fn candidate(&self, redirected: bool) -> Result<&CreditCandidate<'a, 'info>> {
        if redirected {
            self.redirect.as_ref().ok_or(error!(OFTError::InvalidCreditAccountPlan))
        } else {
            Ok(&self.recipient)
        }
    }
}
