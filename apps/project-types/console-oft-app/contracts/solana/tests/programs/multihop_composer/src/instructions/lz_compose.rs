use crate::{payload, ComposerError, ComposerStore, COMPOSER_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use oapp::{
    endpoint::{types::ClearComposeParams, ID as ENDPOINT_ID},
    endpoint_cpi::{clear_compose, CLEAR_COMPOSE_MIN_ACCOUNTS_LEN},
    types::LzComposeParams,
};

use super::send_accounts::{optional_placeholder, SEND_FIXED_LEN};

/// `remaining_accounts` layout, matching what `lz_compose_types_v3` plans:
/// `[clear_compose(5)][send fixed(SEND_FIXED_LEN)][send remaining: transfer_hook…, fee_hook…,
/// endpoint…]`.
#[derive(Accounts)]
#[instruction(params: LzComposeParams)]
pub struct LzCompose<'info> {
    #[account(
        mut,
        seeds = [COMPOSER_SEED],
        bump = composer_store.bump,
        constraint = composer_store.key() == params.to,
        // Anyone can queue a compose message; only the OFT this composer serves is trusted.
        constraint = composer_store.oft_store == params.from @ ComposerError::UntrustedSender,
        has_one = token_mint,
    )]
    pub composer_store: Account<'info, ComposerStore>,

    /// The composer's own holdings, credited by the OFT during `lz_receive`, and the source the
    /// second hop debits.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = composer_store,
        associated_token::token_program = token_program,
    )]
    pub composer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: The OFT carrying the second hop; also `send`'s own `program` account.
    #[account(address = console_oft::ID)]
    pub oft_program: UncheckedAccount<'info>,
}

impl<'info> LzCompose<'info> {
    pub fn apply(
        ctx: &mut Context<'info, LzCompose<'info>>,
        params: &LzComposeParams,
    ) -> Result<()> {
        let hop = payload::send_params(&params.message)?;

        let (clear_accounts, rest) = ctx
            .remaining_accounts
            .split_at_checked(CLEAR_COMPOSE_MIN_ACCOUNTS_LEN)
            .ok_or(ComposerError::MissingSendAccounts)?;
        let (send_fixed, send_remaining) = rest
            .split_at_checked(SEND_FIXED_LEN)
            .ok_or(ComposerError::MissingSendAccounts)?;

        clear_compose(
            ENDPOINT_ID,
            ctx.accounts.composer_store.key(),
            clear_accounts,
            &ctx.accounts.composer_store.signer_seeds(),
            ClearComposeParams {
                from: params.from,
                guid: params.guid,
                index: params.index,
                message: params.message.clone(),
            },
        )?;

        let [oft_store, peer, enforced_options, pause_config, fee_config, default_rate_limit, rate_limit, address_exemption, oft_escrow, fee_deposit, burn_policy, burn_role, burn_manager, burn_signer, event_authority] =
            send_fixed
        else {
            return err!(ComposerError::MissingSendAccounts);
        };

        let accounts = console_oft::cpi::accounts::Send {
            signer: ctx.accounts.composer_store.to_account_info(),
            oft_store: oft_store.clone(),
            peer: peer.clone(),
            enforced_options: enforced_options.clone(),
            pause_config: pause_config.clone(),
            fee_config: fee_config.clone(),
            default_rate_limit: default_rate_limit.clone(),
            rate_limit: rate_limit.clone(),
            address_exemption: address_exemption.clone(),
            token_source: ctx.accounts.composer_token_account.to_account_info(),
            oft_escrow: oft_escrow.clone(),
            fee_deposit: present(fee_deposit),
            token_mint: ctx.accounts.token_mint.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            burn_policy: present(burn_policy),
            burn_role: present(burn_role),
            burn_manager: present(burn_manager),
            burn_signer: present(burn_signer),
            event_authority: event_authority.clone(),
            program: ctx.accounts.oft_program.to_account_info(),
        };

        // The store PDA signs as the token source's authority, the way a wallet signs its own
        // send. Every account after the fixed set is `send`'s own remaining-accounts layout.
        console_oft::cpi::send(
            CpiContext::new_with_signer(
                console_oft::ID,
                accounts,
                &[&ctx.accounts.composer_store.signer_seeds()],
            )
            .with_remaining_accounts(send_remaining.to_vec()),
            hop,
        )?;
        Ok(())
    }
}

/// The plan fills an absent optional account with the callee's program id, Anchor's own
/// convention, so the CPI must turn that placeholder back into `None`.
fn present<'info>(account: &AccountInfo<'info>) -> Option<AccountInfo<'info>> {
    (account.key() != optional_placeholder()).then(|| account.clone())
}
