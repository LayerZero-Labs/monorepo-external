//! Framing for one transfer-hook account group: `[hook program, canonical manifest witness,
//! resolved extras...]`. An unallocated manifest must still be supplied at its canonical address as
//! evidence of absence, and is then dropped from the native CPI accounts: SPL's CPI helper parses
//! any manifest it is given.

use crate::{get_transfer_hook_program_id, OFTError};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::{
    get_extra_account_metas_address, instruction::ExecuteInstruction,
};
use spl_type_length_value::state::TlvStateBorrowed;

/// Distinguishes an absent account from an initialized list with zero entries.
pub(crate) enum TransferHookManifest {
    Absent,
    Initialized { extra_accounts: usize },
}

impl TransferHookManifest {
    pub(crate) fn read(mint: &Pubkey, hook: &Pubkey, account: &AccountInfo) -> Result<Self> {
        require_keys_eq!(
            *account.key,
            get_extra_account_metas_address(mint, hook),
            OFTError::InvalidExtraAccountMetaList
        );
        require!(!account.executable, OFTError::InvalidExtraAccountMetaList);
        if account.owner == &System::id() && account.data_is_empty() {
            return Ok(Self::Absent);
        }
        require_keys_eq!(*account.owner, *hook, OFTError::InvalidExtraAccountMetaList);
        let data = account.try_borrow_data()?;
        let tlv = TlvStateBorrowed::unpack(&data)?;
        let list = ExtraAccountMetaList::unpack_with_tlv_state::<ExecuteInstruction>(&tlv)?;
        Ok(Self::Initialized { extra_accounts: list.len() })
    }
}

/// A mint's transfer-hook program, read once per instruction and shared by every group it parses.
#[derive(Clone, Copy)]
pub struct MintTransferHook {
    mint: Pubkey,
    program: Option<Pubkey>,
}

impl MintTransferHook {
    pub fn read(mint: &InterfaceAccount<Mint>) -> Result<Self> {
        Ok(Self { mint: mint.key(), program: get_transfer_hook_program_id(mint)? })
    }
}

/// A checked, complete hook group. Native SPL validates resolved extra-account identities and
/// privileges for the actual transfer; this view owns framing and native forwarding, not policy.
pub struct TransferHookAccounts<'a, 'info> {
    cpi_accounts: &'a [AccountInfo<'info>],
}

impl<'a, 'info> TransferHookAccounts<'a, 'info> {
    /// Consume one group, leaving the next hook/fee/Endpoint group untouched.
    pub fn take_prefix(
        mint: &MintTransferHook,
        accounts: &'a [AccountInfo<'info>],
    ) -> Result<(Self, &'a [AccountInfo<'info>])> {
        let Some(hook) = mint.program else {
            return Ok((Self { cpi_accounts: &accounts[..0] }, accounts));
        };
        let program = accounts.first().ok_or(OFTError::InsufficientRemainingAccounts)?;
        require_keys_eq!(*program.key, hook, OFTError::InvalidTransferHookProgram);
        require!(program.executable, OFTError::InvalidTransferHookProgram);
        let witness = accounts.get(1).ok_or(OFTError::InsufficientRemainingAccounts)?;
        let manifest = TransferHookManifest::read(&mint.mint, &hook, witness)?;
        let count = match manifest {
            TransferHookManifest::Absent => 2,
            TransferHookManifest::Initialized { extra_accounts } => 2 + extra_accounts,
        };
        let (group, remaining) = accounts
            .split_at_checked(count)
            .ok_or(OFTError::InsufficientRemainingAccounts)?;
        let cpi_accounts = match manifest {
            TransferHookManifest::Absent => &group[..1],
            TransferHookManifest::Initialized { .. } => group,
        };
        Ok((Self { cpi_accounts }, remaining))
    }

    /// Validate a group with no permitted trailing accounts (e.g. the last receive candidate).
    pub fn parse_exact(
        mint: &MintTransferHook,
        accounts: &'a [AccountInfo<'info>],
    ) -> Result<Self> {
        let (group, remaining) = Self::take_prefix(mint, accounts)?;
        require!(remaining.is_empty(), OFTError::InvalidCreditAccountPlan);
        Ok(group)
    }

    pub fn cpi_accounts(&self) -> &'a [AccountInfo<'info>] {
        self.cpi_accounts
    }
}
