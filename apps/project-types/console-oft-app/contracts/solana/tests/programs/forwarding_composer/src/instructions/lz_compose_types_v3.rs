use crate::{payload, ComposerStore};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{Mint, TokenAccount},
};
use console_oft::{
    append_transfer_hook_accounts, errors::OFTError, get_transfer_hook_program_id,
    token_account_seed_prefix, TransferHookDestination,
};
use oapp::{
    common::{AccountMetaRef, AddressLocator, EXECUTION_CONTEXT_VERSION_1},
    endpoint::ID as ENDPOINT_ID,
    lz_compose_types_v3::{
        get_accounts_for_clear_compose, ComposeInstruction, LzComposeTypesV3Result,
    },
    types::LzComposeParams,
};

use token_manager_interface::acl;

#[derive(Accounts)]
#[instruction(params: LzComposeParams)]
pub struct LzComposeTypesV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Ephemeral scratch the caller creates and signs for; `oapp::lz_plan` validates it.
    #[account(mut)]
    pub plan_out: Signer<'info>,

    #[account(constraint = composer_store.key() == params.to, has_one = token_mint)]
    pub composer_store: Account<'info, ComposerStore>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    pub composer_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: The hook's manifest, present only when the mint carries a transfer hook.
    pub extra_account_meta_list: Option<UncheckedAccount<'info>>,

    /// CHECK: The fixture's gate (this repo's TokenManager) thaw manifest, when ACL applies;
    /// `acl::ThawPlan` checks its address.
    pub acl_thaw_metas: Option<UncheckedAccount<'info>>,
}

impl LzComposeTypesV3<'_> {
    pub fn apply<'info>(
        ctx: &mut Context<'info, LzComposeTypesV3<'info>>,
        params: &LzComposeParams,
    ) -> Result<u32> {
        let recipient = payload::final_recipient(&params.message)?;
        let amount = payload::amount_ld(&params.message)?;
        let mint = ctx.accounts.token_mint.key();
        let token_program = *ctx.accounts.token_mint.to_account_info().owner;
        let recipient_token_account =
            get_associated_token_address_with_program_id(&recipient, &mint, &token_program);

        let needs_acl = acl::requires_acl(&mint, ctx.accounts.token_mint.freeze_authority, true);
        let optional = |key: Pubkey, writable: bool| AccountMetaRef {
            pubkey: if needs_acl { key } else { crate::ID }.into(),
            is_writable: needs_acl && writable,
        };
        let mut accounts = vec![
            AccountMetaRef { pubkey: ctx.accounts.composer_store.key().into(), is_writable: true },
            AccountMetaRef {
                pubkey: ctx.accounts.composer_token_account.key().into(),
                is_writable: true,
            },
            AccountMetaRef { pubkey: recipient.into(), is_writable: false },
            AccountMetaRef { pubkey: recipient_token_account.into(), is_writable: true },
            AccountMetaRef { pubkey: mint.into(), is_writable: true },
            AccountMetaRef { pubkey: token_program.into(), is_writable: false },
            AccountMetaRef { pubkey: AddressLocator::Payer, is_writable: true },
            AccountMetaRef { pubkey: anchor_spl::associated_token::ID.into(), is_writable: false },
            AccountMetaRef { pubkey: System::id().into(), is_writable: false },
            optional(ctx.accounts.composer_store.pubkey_policy, false),
            optional(
                pubkey_policy_interface::subject_address(
                    &ctx.accounts.composer_store.pubkey_policy,
                    &recipient,
                )
                .0,
                false,
            ),
            optional(acl::mint_config_address(&mint), false),
            optional(acl::thaw_metas_address(&mint, &token_manager_interface::ID), false),
            optional(acl::flag_address(&recipient_token_account), true),
            optional(acl::TOKEN_ACL_ID, false),
            optional(token_manager_interface::ID, false),
        ];
        accounts.extend(get_accounts_for_clear_compose(
            ENDPOINT_ID,
            &params.from,
            &params.to,
            &params.guid,
            params.index,
            &params.message,
        ));
        if needs_acl {
            let manifest =
                ctx.accounts.acl_thaw_metas.as_ref().ok_or(OFTError::InvalidAclThawMetas)?;
            let synthetic = token_account_seed_prefix(mint, recipient);
            let extras = acl::ThawPlan {
                manifest,
                mint: &ctx.accounts.token_mint.to_account_info(),
                gate: &token_manager_interface::ID,
                token_account: &recipient_token_account,
                token_account_data: &synthetic,
                owner: &recipient,
            }
            .extras()
            .map_err(|_| error!(OFTError::InvalidAclThawMetas))?;
            accounts.extend(extras.into_iter().map(|meta| AccountMetaRef {
                pubkey: meta.pubkey.into(),
                is_writable: meta.is_writable,
            }));
        }
        Self::append_hook_accounts(
            &ctx.accounts.token_mint,
            &ctx.accounts.composer_token_account.to_account_info(),
            &ctx.accounts.composer_store.to_account_info(),
            ctx.accounts.extra_account_meta_list.as_ref(),
            ctx.remaining_accounts,
            &mut accounts,
            recipient,
            recipient_token_account,
            amount,
        )?;

        let plan = LzComposeTypesV3Result {
            context_version: EXECUTION_CONTEXT_VERSION_1,
            instructions: vec![ComposeInstruction::LzCompose { accounts }],
        };
        oapp::lz_plan::write(ctx.program_id, &ctx.accounts.plan_out, &plan)
    }

    #[allow(clippy::too_many_arguments)]
    fn append_hook_accounts<'info>(
        token_mint: &InterfaceAccount<'info, Mint>,
        source: &AccountInfo<'info>,
        authority: &AccountInfo<'info>,
        meta_list: Option<&UncheckedAccount<'info>>,
        remaining_accounts: &[AccountInfo<'info>],
        accounts: &mut Vec<AccountMetaRef>,
        recipient: Pubkey,
        recipient_token_account: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let Some(hook_program) = get_transfer_hook_program_id(token_mint)? else {
            return Ok(());
        };
        let meta_list = meta_list.ok_or(OFTError::InvalidExtraAccountMetaList)?;
        // The destination may not exist at plan time; a PDA seeds from its mint or owner.
        let existing_destination =
            remaining_accounts.iter().find(|info| info.key() == recipient_token_account);
        let destination_data =
            existing_destination.map(|info| info.try_borrow_data()).transpose()?;
        let synthetic = token_account_seed_prefix(token_mint.key(), recipient);
        let data = destination_data
            .as_ref()
            .filter(|data| !data.is_empty())
            .map_or(synthetic.as_slice(), |data| data.as_ref());

        append_transfer_hook_accounts(
            accounts,
            &hook_program,
            source,
            &token_mint.to_account_info(),
            TransferHookDestination { key: recipient_token_account, data },
            authority,
            &meta_list.to_account_info(),
            amount,
        )
    }
}
