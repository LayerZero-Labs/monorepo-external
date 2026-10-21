use crate::errors::HookError;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use pubkey_policy_interface::{PolicyError, ValidatedPubkeyPolicy};
use spl_token_2022_interface::{
    extension::{
        permanent_delegate::get_permanent_delegate, transfer_hook::TransferHookAccount,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::{Account as AccountState, Mint as MintState},
};

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TransferHookParams {
    /// SPL `Execute` payload; unused, since the policy does not depend on the amount.
    pub amount: u64,
}

/// Token-2022 invokes this during a transfer with the accounts it resolved from this mint's
/// manifest, which only `init_transfer_hook` writes (first extra: the bound pubkey policy). The
/// hook writes nothing and makes no CPI. It requires Token-2022's `transferring` flag on both token
/// accounts, so a direct `Execute` call fails instead of looking like a transfer; it does not
/// re-check the manifest.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    pub source: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    pub destination: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Token-2022 validated the owner, delegate or permanent delegate.
    pub authority: UncheckedAccount<'info>,

    /// CHECK: The canonical manifest Token-2022 resolved the extras from.
    pub extra_account_metas: UncheckedAccount<'info>,

    /// CHECK: The policy the manifest binds; decoded in the handler.
    pub pubkey_policy: UncheckedAccount<'info>,

    /// CHECK: The program that owns the policy and its records, named by the manifest for the
    /// records' derivation; never invoked. The reader takes the program from the policy's owner,
    /// so a manifest naming another program fails the record check.
    pub policy_program: UncheckedAccount<'info>,

    /// CHECK: Owner's subject record; `ValidatedPubkeyPolicy::read` checks its address and owner.
    pub source_record: UncheckedAccount<'info>,

    /// CHECK: Owner's subject record; `ValidatedPubkeyPolicy::read` checks its address and owner.
    pub destination_record: UncheckedAccount<'info>,

    /// CHECK: Authority's subject record; `ValidatedPubkeyPolicy::read` checks its address and
    /// owner.
    pub authority_record: UncheckedAccount<'info>,
}

impl TransferHook<'_> {
    pub fn apply(ctx: &Context<Self>, _params: &TransferHookParams) -> Result<()> {
        let accounts = &ctx.accounts;
        require!(
            is_transferring(&accounts.source)? && is_transferring(&accounts.destination)?,
            HookError::NotTransferring
        );

        // The mint's Permanent Delegate is exempt, matching EVM `recoverFunds`' unchecked
        // `_transfer`. Token-2022 has authenticated it and already rejects frozen accounts.
        if accounts.authority_is_permanent_delegate()? {
            return Ok(());
        }

        // Check source, destination and the actual executing authority, not source.delegate:
        // Token-2022 clears an exhausted delegate allowance before invoking us.
        for (record, subject) in [
            (&accounts.source_record, accounts.source.owner),
            (&accounts.destination_record, accounts.destination.owner),
            (&accounts.authority_record, accounts.authority.key()),
        ] {
            let validated = ValidatedPubkeyPolicy::read(&accounts.pubkey_policy, record, &subject)?;
            // `init_transfer_hook` already refuses another mint's policy; checked again so the hook
            // stays correct on its own.
            require_keys_eq!(validated.mint(), accounts.mint.key(), HookError::WrongPolicyMint);
            require!(!validated.is_blocked(), PolicyError::Blocked);
        }
        Ok(())
    }

    fn authority_is_permanent_delegate(&self) -> Result<bool> {
        let mint_info = self.mint.to_account_info();
        let mint_data = mint_info.try_borrow_data()?;
        let mint = StateWithExtensions::<MintState>::unpack(&mint_data)?;
        Ok(get_permanent_delegate(&mint) == Some(self.authority.key()))
    }
}

/// Token-2022 sets `transferring` on both accounts only for the duration of the hook call.
fn is_transferring(account: &InterfaceAccount<TokenAccount>) -> Result<bool> {
    let info = account.to_account_info();
    let data = info.try_borrow_data()?;
    let state = StateWithExtensions::<AccountState>::unpack(&data)?;
    Ok(state
        .get_extension::<TransferHookAccount>()
        .is_ok_and(|ext| bool::from(ext.transferring)))
}
