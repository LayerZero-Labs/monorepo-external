//! Permissionless thaw of one token account, run in the consuming program.
use std::iter::once;

use super::{read_mint_config, AclError, AclResult};
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::AccountMeta, program::invoke},
};
use pubkey_policy_interface::ValidatedPubkeyPolicy;
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount,
        confidential_transfer_fee::ConfidentialTransferFeeAmount, transfer_fee::TransferFeeAmount,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account as TokenAccount,
};

/// A token account's balance state for the permissionless gate. `Empty` means a zero public
/// balance and closable withheld-fee and confidential balances; it says nothing about whether the
/// account was used before. Native (wrapped SOL) accounts are `Unsupported`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Emptiness {
    Empty,
    Funded,
    Unsupported,
}

/// Errs only on unparseable data, including unrecognized extension types.
pub fn account_emptiness(data: &[u8]) -> core::result::Result<Emptiness, ProgramError> {
    use spl_token_2022_interface::extension::ExtensionType;
    let account = StateWithExtensions::<TokenAccount>::unpack(data)?;
    if account.base.is_native.is_some() {
        return Ok(Emptiness::Unsupported);
    }
    if account.base.amount != 0 {
        return Ok(Emptiness::Funded);
    }
    for extension in account.get_extension_types()? {
        let empty = match extension {
            ExtensionType::TransferFeeAmount => {
                account.get_extension::<TransferFeeAmount>()?.closable().is_ok()
            },
            ExtensionType::ConfidentialTransferAccount => {
                account.get_extension::<ConfidentialTransferAccount>()?.closable().is_ok()
            },
            ExtensionType::ConfidentialTransferFeeAmount => {
                account.get_extension::<ConfidentialTransferFeeAmount>()?.closable().is_ok()
            },
            // Other recognized extensions carry no balance. When upgrading Token-2022, add any
            // newly recognized balance-bearing extension above.
            _ => true,
        };
        if !empty {
            return Ok(Emptiness::Funded);
        }
    }
    Ok(Emptiness::Empty)
}

/// Accounts for [`Self::thaw_if_eligible`]. `payer` signs Token ACL's thaw as its authority and
/// must be writable: Token ACL refunds the transient flag account's lamports to it, and anyone can
/// pre-fund that address.
/// `manifest` is the thaw manifest of the gate the config names
/// ([`has_thaw_manifest`](super::has_thaw_manifest)).
pub struct ThawAccounts<'a, 'info> {
    pub payer: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub token_account: &'a AccountInfo<'info>,
    pub owner: &'a AccountInfo<'info>,
    pub config: &'a AccountInfo<'info>,
    pub manifest: &'a AccountInfo<'info>,
    pub flag: &'a AccountInfo<'info>,
    pub acl_program: &'a AccountInfo<'info>,
    pub gate_program: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
}

impl<'info> ThawAccounts<'_, 'info> {
    /// Thaws `token_account` through Token ACL and returns `true` when the mint's config names a
    /// gate (not `Pubkey::default()`) and enables permissionless thaw, the account is frozen and
    /// empty, and `validated` does not block the subject; otherwise returns `false` and changes
    /// nothing.
    ///
    /// `validated` is the caller's own policy, standing in for the gate's answer: a gate that
    /// refuses fails the CPI and with it the transaction. `gate_extras` are the accounts the gate's
    /// manifest names: [`thaw_extra_count`](super::thaw_extra_count) of them, as
    /// [`ThawPlan`](super::ThawPlan) plans them. Token ACL resolves the
    /// manifest again and rejects any that do not match, and it and the runtime check the gate,
    /// flag, programs and payer signature. After `Ok(true)`, reload any deserialized copy of the
    /// token account.
    pub fn thaw_if_eligible(
        &self,
        validated: &ValidatedPubkeyPolicy,
        gate_extras: &[AccountInfo<'info>],
    ) -> AclResult<bool> {
        let (mint, subject) = (validated.mint(), validated.subject());
        if self.mint.key != &mint
            || self.owner.key != &subject
            || self.mint.owner != &spl_token_2022_interface::ID
            || self.token_account.owner != &spl_token_2022_interface::ID
        {
            return Err(AclError::InvalidTokenAccount);
        }
        // The config is read as this helper's own eligibility input, so it must be the mint's.
        // Token ACL always calls the gate, so a config without one (`Pubkey::default()`, the
        // System Program) can never thaw permissionlessly.
        let config = read_mint_config(self.config, self.mint.key)?;
        let thaw_enabled =
            config.enable_permissionless_thaw && config.gating_program != Pubkey::default();
        {
            let data = self.token_account.try_borrow_data()?;
            let account = StateWithExtensions::<TokenAccount>::unpack(&data)?;
            if account.base.mint != mint || account.base.owner != subject {
                return Err(AclError::InvalidTokenAccount);
            }
            if !account.base.is_frozen() {
                return Ok(false);
            }
        }
        if !thaw_enabled || validated.is_blocked() {
            return Ok(false);
        }
        match account_emptiness(&self.token_account.try_borrow_data()?)? {
            Emptiness::Empty => {},
            Emptiness::Funded => return Ok(false),
            Emptiness::Unsupported => return Err(AclError::UnsupportedAccount),
        }
        // Without a manifest Token ACL calls the gate with no extras; an unallocated manifest must
        // not be forwarded, since Token ACL parses any manifest it finds.
        let forwarded: Vec<&AccountInfo<'info>> = if self.manifest.data_is_empty() {
            vec![]
        } else {
            once(self.manifest).chain(gate_extras).collect()
        };
        let remaining: Vec<AccountMeta> = forwarded
            .iter()
            .map(|info| AccountMeta {
                pubkey: *info.key,
                is_signer: false,
                is_writable: info.is_writable,
            })
            .collect();
        let mut instruction = token_acl_client::instructions::ThawPermissionlessIdempotent {
            authority: *self.payer.key,
            mint: *self.mint.key,
            token_account: *self.token_account.key,
            flag_account: *self.flag.key,
            token_account_owner: *self.owner.key,
            mint_config: *self.config.key,
            token_program: *self.token_program.key,
            system_program: *self.system_program.key,
            gating_program: *self.gate_program.key,
        }
        .instruction_with_remaining_accounts(&remaining);
        // The generated client marks the authority read-only, so a pre-funded flag account would
        // make Token ACL's refund a rejected credit and block this account's permissionless thaw.
        instruction.accounts[0].is_writable = true;
        let mut infos = vec![
            self.payer.clone(),
            self.mint.clone(),
            self.token_account.clone(),
            self.flag.clone(),
            self.owner.clone(),
            self.config.clone(),
            self.token_program.clone(),
            self.system_program.clone(),
            self.gate_program.clone(),
            self.acl_program.clone(),
        ];
        infos.extend(forwarded.into_iter().cloned());
        invoke(&instruction, &infos)?;
        Ok(true)
    }
}
