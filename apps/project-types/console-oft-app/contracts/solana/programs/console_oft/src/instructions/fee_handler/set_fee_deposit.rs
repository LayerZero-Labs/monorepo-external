use crate::{events::FeeDepositSet, OFTError, OFTStore, RoleMember, RoleType};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

/// Sets the fee deposit address.
/// EVM alignment: FeeHandlerRBACUpgradeable.setFeeDeposit(address) - onlyRole(DEFAULT_ADMIN_ROLE)
#[rbac::only_role(role = RoleType::DefaultAdmin, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(new_fee_deposit: Pubkey)]
pub struct SetFeeDeposit<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,

    // The fee deposit token account must already exist; this instruction only
    // validates it and stores its address. Not owned by `oft_store`, which spends only from its
    // escrow: fees sent to any account it owns (the escrow included) could never be swept.
    #[account(
        token::mint = oft_store.token_mint,
        constraint = fee_deposit.key() == new_fee_deposit @ OFTError::InvalidFeeDeposit,
        constraint = fee_deposit.owner != oft_store.key() @ OFTError::InvalidFeeDeposit,
        constraint = !fee_deposit.is_frozen() @ OFTError::FeeDepositFrozen,
    )]
    pub fee_deposit: InterfaceAccount<'info, TokenAccount>,
}

impl SetFeeDeposit<'_> {
    pub fn apply(ctx: &mut Context<Self>, new_fee_deposit: &Pubkey) -> Result<()> {
        let fee_deposit = *new_fee_deposit;
        ctx.accounts.oft_store.fee_deposit = fee_deposit;
        emit_cpi!(FeeDepositSet { oft_store: ctx.accounts.oft_store.key(), fee_deposit });
        Ok(())
    }
}
