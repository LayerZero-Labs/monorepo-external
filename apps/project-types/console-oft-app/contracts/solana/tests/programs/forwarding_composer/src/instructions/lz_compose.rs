use crate::{payload, ComposerError, ComposerStore, COMPOSER_SEED};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use console_oft::{errors::OFTError, MintTransferHook, TransferHookAccounts};
use oapp::{
    endpoint::{types::ClearComposeParams, ID as ENDPOINT_ID},
    endpoint_cpi::{clear_compose, CLEAR_COMPOSE_MIN_ACCOUNTS_LEN},
    types::LzComposeParams,
};
use pubkey_policy_interface::{PubkeyPolicy, ValidatedPubkeyPolicy};
use spl_token_2022::onchain::invoke_transfer_checked;
use token_manager_interface::acl::{self, ThawAccounts};

/// `remaining_accounts` layout: `[clear_compose..., gate..., transfer_hook...]`, where the gate
/// group is the extras the Token ACL gate's thaw manifest names, present only when ACL applies.
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

    /// The composer's own holdings, credited by the OFT during `lz_receive`.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = composer_store,
        associated_token::token_program = token_program,
    )]
    pub composer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: The final recipient named in the payload; need not exist or sign.
    pub recipient: UncheckedAccount<'info>,

    /// Created here for SPL and Token-2022; eligible ACL thaw is performed inline.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    #[account(address = composer_store.pubkey_policy, constraint = pubkey_policy.mint == token_mint.key())]
    pub pubkey_policy: Option<Box<Account<'info, PubkeyPolicy>>>,
    /// CHECK: ValidatedPubkeyPolicy authenticates the canonical subject record.
    pub pubkey_policy_record: Option<UncheckedAccount<'info>>,
    /// CHECK: Shared ACL helper validates canonical address, owner and binding.
    pub acl_mint_config: Option<UncheckedAccount<'info>>,
    /// CHECK: Shared ACL helper checks it is the configured gate's thaw manifest.
    pub acl_thaw_metas: Option<UncheckedAccount<'info>>,
    /// CHECK: Shared ACL helper pins transient native flag.
    #[account(mut)]
    pub acl_flag: Option<UncheckedAccount<'info>>,
    /// CHECK: Shared ACL helper pins executable native ACL.
    pub acl_program: Option<UncheckedAccount<'info>>,
    /// CHECK: The gate the MintConfig names; Token ACL checks it.
    pub acl_gate_program: Option<UncheckedAccount<'info>>,
}

impl<'info> LzCompose<'info> {
    pub fn apply(
        ctx: &mut Context<'info, LzCompose<'info>>,
        params: &LzComposeParams,
    ) -> Result<()> {
        let recipient = payload::final_recipient(&params.message)?;
        require_keys_eq!(recipient, ctx.accounts.recipient.key(), ErrorCode::ConstraintAddress);
        let amount = payload::amount_ld(&params.message)?;

        let (clear_accounts, rest) = ctx
            .remaining_accounts
            .split_at_checked(CLEAR_COMPOSE_MIN_ACCOUNTS_LEN)
            .ok_or(OFTError::InsufficientRemainingAccounts)?;
        let invalid = |error| match error {
            acl::AclError::Program(error) => anchor_lang::error::Error::from(error),
            _ => error!(crate::ComposerError::InvalidAclInputs),
        };
        let mut hook_accounts = rest;
        if acl::requires_acl(
            &ctx.accounts.token_mint.key(),
            ctx.accounts.token_mint.freeze_authority,
            true,
        ) {
            let a = &ctx.accounts;
            let policy =
                a.pubkey_policy.as_deref().ok_or(crate::ComposerError::InvalidAclInputs)?;
            let record =
                a.pubkey_policy_record.as_ref().ok_or(crate::ComposerError::InvalidAclInputs)?;
            let validated =
                ValidatedPubkeyPolicy::read(&policy.to_account_info(), record, &recipient)?;
            let config =
                a.acl_mint_config.as_ref().ok_or(crate::ComposerError::InvalidAclInputs)?;
            let manifest =
                a.acl_thaw_metas.as_ref().ok_or(crate::ComposerError::InvalidAclInputs)?;
            let gate_extras =
                acl::thaw_extra_count(config, manifest, &a.token_mint.key()).map_err(invalid)?;
            let (gate, hooks) = rest
                .split_at_checked(gate_extras)
                .ok_or(OFTError::InsufficientRemainingAccounts)?;
            hook_accounts = hooks;
            let thawed = ThawAccounts {
                payer: &a.payer.to_account_info(),
                mint: &a.token_mint.to_account_info(),
                token_account: &a.recipient_token_account.to_account_info(),
                owner: &a.recipient.to_account_info(),
                config,
                manifest,
                flag: a.acl_flag.as_ref().ok_or(crate::ComposerError::InvalidAclInputs)?,
                acl_program: a
                    .acl_program
                    .as_ref()
                    .ok_or(crate::ComposerError::InvalidAclInputs)?,
                gate_program: a
                    .acl_gate_program
                    .as_ref()
                    .ok_or(crate::ComposerError::InvalidAclInputs)?,
                token_program: &a.token_program.to_account_info(),
                system_program: &a.system_program.to_account_info(),
            }
            .thaw_if_eligible(&validated, gate)
            .map_err(invalid)?;
            // Thaw alone does not screen an already-thawed account, so the blocked recipient is
            // refused here.
            require!(!validated.is_blocked(), crate::ComposerError::RecipientBlocked);
            if thawed {
                ctx.accounts.recipient_token_account.reload()?;
            }
        }

        let hook = MintTransferHook::read(&ctx.accounts.token_mint)?;
        let hooks = TransferHookAccounts::parse_exact(&hook, hook_accounts)?;

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

        // Signed by the store PDA, which is the ATA's authority. The hook screens the recipient
        // exactly as it screens any other transfer of this mint.
        invoke_transfer_checked(
            ctx.accounts.token_program.key,
            ctx.accounts.composer_token_account.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.recipient_token_account.to_account_info(),
            ctx.accounts.composer_store.to_account_info(),
            hooks.cpi_accounts(),
            amount,
            ctx.accounts.token_mint.decimals,
            &[&ctx.accounts.composer_store.signer_seeds()],
        )?;

        ctx.accounts.composer_store.forwarded_count += 1;
        Ok(())
    }
}
