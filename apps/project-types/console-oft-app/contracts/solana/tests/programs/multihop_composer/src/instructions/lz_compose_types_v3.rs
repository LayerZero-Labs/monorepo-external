//! Plans the whole second hop: the compose clear, the OFT's entire `send` account set, both of
//! `send`'s transfer-hook groups, and the Endpoint's send accounts.
//!
//! There is no preparation instruction. A multihop composer's destination is on another chain,
//! so unlike the forwarding composer it has no local token account to create and thaw.

use crate::{payload, ComposerStore, PlannedAccount};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use console_oft::{
    append_transfer_hook_accounts, get_transfer_hook_program_id, instructions::debit_view,
    permissioned_burn_active, state::FeeConfig, OAppPeer,
};
use oapp::{
    common::{AccountMetaRef, AddressLocator, EXECUTION_CONTEXT_VERSION_1},
    endpoint::{accounts::SendLibraryConfig, ID as ENDPOINT_ID},
    lz_compose_types_v3::{
        get_accounts_for_clear_compose, ComposeInstruction, LzComposeTypesV3Result,
    },
    types::LzComposeParams,
    utils::try_load_account,
};

use super::send_accounts::{endpoint_send_metas, SendFixedAccounts};

#[derive(Accounts)]
#[instruction(params: LzComposeParams)]
pub struct LzComposeTypesV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Ephemeral scratch the caller creates and signs for; `oapp::lz_plan` validates it.
    #[account(mut)]
    pub plan_out: Signer<'info>,

    #[account(
        constraint = composer_store.key() == params.to,
        has_one = token_mint,
        has_one = oft_store,
    )]
    pub composer_store: Account<'info, ComposerStore>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub composer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub oft_store: Box<Account<'info, console_oft::state::OFTStore>>,

    /// `send` moves the tokens here first. Its live data is what the transfer hook's resolver
    /// reads to derive the destination's policy record, so a derived address will not do.
    #[account(token::mint = token_mint, token::authority = oft_store)]
    pub oft_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Where `send` sweeps the OFT fee, and the destination of the second hook group.
    #[account(address = oft_store.fee_deposit)]
    pub fee_deposit: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The second hop's peer, read for the 32-byte receiver in the Endpoint's nonce PDA.
    pub peer: Box<Account<'info, OAppPeer>>,

    /// CHECK: Per-EID fee override; absent means the OFT's default applies. Read to decide
    /// whether `send` sweeps a fee, which is what puts a second hook group in the plan.
    pub fee_config: UncheckedAccount<'info>,

    /// CHECK: Endpoint `SendLibraryConfig` for this OApp and EID; may be uninitialized.
    pub send_library_config: UncheckedAccount<'info>,

    /// CHECK: Endpoint default `SendLibraryConfig` for this EID, used when the OApp has no
    /// override. Mirrors the off-chain resolution in send-helper.ts:249.
    pub default_send_library_config: UncheckedAccount<'info>,

    /// CHECK: The hook's manifest, present only when the mint carries a transfer hook.
    pub extra_account_meta_list: Option<UncheckedAccount<'info>>,
}

impl LzComposeTypesV3<'_> {
    pub fn apply<'info>(
        ctx: &mut Context<'info, LzComposeTypesV3<'info>>,
        params: &LzComposeParams,
    ) -> Result<u32> {
        let hop = payload::send_params(&params.message)?;
        let store = &ctx.accounts.composer_store;
        let oft_store_key = ctx.accounts.oft_store.key();
        let token_program = *ctx.accounts.token_mint.to_account_info().owner;

        let send = SendFixedAccounts::derive(
            &oft_store_key,
            &ctx.accounts.oft_store,
            hop.dst_eid,
            hop.compose_msg.as_deref(),
            &store.key(),
            &store.token_manager,
            permissioned_burn_active(&ctx.accounts.token_mint)?,
        );

        let mut accounts = vec![
            AccountMetaRef { pubkey: store.key().into(), is_writable: true },
            AccountMetaRef {
                pubkey: ctx.accounts.composer_token_account.key().into(),
                is_writable: true,
            },
            AccountMetaRef { pubkey: ctx.accounts.token_mint.key().into(), is_writable: true },
            AccountMetaRef { pubkey: token_program.into(), is_writable: false },
            AccountMetaRef { pubkey: console_oft::ID.into(), is_writable: false },
        ];
        accounts.extend(get_accounts_for_clear_compose(
            ENDPOINT_ID,
            &params.from,
            &params.to,
            &params.guid,
            params.index,
            &params.message,
        ));
        accounts.extend(send.metas());
        Self::append_send_hook_groups(ctx, hop.amount_ld, &mut accounts)?;
        accounts.extend(endpoint_send_metas(
            &oft_store_key,
            hop.dst_eid,
            &ctx.accounts.peer.address,
            &store.send_library_program,
            &Self::message_lib(ctx)?,
        ));
        accounts.extend(store.send_library_tail.iter().map(planned));

        let plan = LzComposeTypesV3Result {
            context_version: EXECUTION_CONTEXT_VERSION_1,
            instructions: vec![ComposeInstruction::LzCompose { accounts }],
        };
        oapp::lz_plan::write(ctx.program_id, &ctx.accounts.plan_out, &plan)
    }

    /// `send` runs source→escrow always, and escrow→fee_deposit only when the fee is non-zero,
    /// each with its own hook group (`send.rs:219`). A plan that guesses wrong here misaligns
    /// every remaining account after it.
    fn append_send_hook_groups<'info>(
        ctx: &Context<'info, LzComposeTypesV3<'info>>,
        amount_ld: u64,
        accounts: &mut Vec<AccountMetaRef>,
    ) -> Result<()> {
        let Some(hook_program) = get_transfer_hook_program_id(&ctx.accounts.token_mint)? else {
            return Ok(());
        };
        let meta_list = ctx
            .accounts
            .extra_account_meta_list
            .as_ref()
            .ok_or(console_oft::errors::OFTError::InvalidExtraAccountMetaList)?;
        let fee_config: Option<FeeConfig> = try_load_account(&ctx.accounts.fee_config)?;
        let (amount_sent_ld, amount_received_ld) =
            debit_view(&ctx.accounts.oft_store, fee_config.as_ref(), amount_ld, 0)?;

        let mint = ctx.accounts.token_mint.to_account_info();
        let composer_ata = ctx.accounts.composer_token_account.to_account_info();
        let escrow = ctx.accounts.oft_escrow.to_account_info();
        let fee_deposit = ctx.accounts.fee_deposit.to_account_info();
        let store = ctx.accounts.composer_store.to_account_info();
        let oft_store = ctx.accounts.oft_store.to_account_info();
        // Both endpoints of both transfers already exist, so every hook account resolves from
        // real data. Nothing here needs the synthetic seed prefix a not-yet-created destination
        // forces on the forwarding composer.
        let mut transfers = vec![(&composer_ata, &escrow, &store, amount_sent_ld)];
        let fee_ld = amount_sent_ld - amount_received_ld;
        if fee_ld > 0 {
            transfers.push((&escrow, &fee_deposit, &oft_store, fee_ld));
        }

        for (source, destination, authority, amount) in transfers {
            let destination_data = destination.try_borrow_data()?;
            append_transfer_hook_accounts(
                accounts,
                &hook_program,
                source,
                &mint,
                console_oft::TransferHookDestination {
                    key: destination.key(),
                    data: &destination_data,
                },
                authority,
                &meta_list.to_account_info(),
                amount,
            )?;
        }
        Ok(())
    }

    /// The Endpoint falls back to the default library when the OApp has not set one; an
    /// uninitialized override account and the all-zero sentinel mean the same thing.
    fn message_lib(ctx: &Context<LzComposeTypesV3>) -> Result<Pubkey> {
        let configured: Option<SendLibraryConfig> =
            try_load_account(&ctx.accounts.send_library_config)?;
        let lib = configured.map(|config| config.message_lib).unwrap_or_default();
        if lib != Pubkey::default() {
            return Ok(lib);
        }
        let default: SendLibraryConfig =
            try_load_account(&ctx.accounts.default_send_library_config)?
                .ok_or(ErrorCode::AccountNotInitialized)?;
        Ok(default.message_lib)
    }
}

/// A configured send-library slot. A signer slot is filled by the Executor's payer: the ULN
/// charges the native fee to a signer, and the compose transaction has no other.
fn planned(account: &PlannedAccount) -> AccountMetaRef {
    AccountMetaRef {
        pubkey: if account.is_signer {
            AddressLocator::Payer
        } else {
            AddressLocator::Address(account.pubkey)
        },
        is_writable: account.is_writable,
    }
}
