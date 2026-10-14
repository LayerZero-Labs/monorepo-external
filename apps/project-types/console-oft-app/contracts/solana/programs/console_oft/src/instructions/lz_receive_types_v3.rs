use crate::{
    append_transfer_hook_accounts, codec, delivered_amount, get_transfer_hook_program_id,
    map_acl_error, resolve_redirect_escrow, token_account_seed_prefix, OAppPeer, OFTError,
    OFTStore, RateLimit, RateLimitAddressExemption, TransferHookDestination, DEFAULT_RATE_LIMIT_ID,
};
use anchor_lang::{prelude::*, solana_program::system_program};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use oapp::{
    common::{AccountMetaRef, AddressLocator, EXECUTION_CONTEXT_VERSION_1},
    endpoint::ID as ENDPOINT_ID,
    lz_plan,
    lz_receive_types_v3::{
        get_accounts_for_clear, get_accounts_for_send_compose, Instruction, LzReceiveTypesV3Result,
    },
    types::LzReceiveParams,
    EVENT_SEED,
};

use token_manager_interface::acl;

/// Step 2 of receive planning: writes the `lz_receive` plan into `plan_out` through
/// `oapp::lz_plan` and returns its byte length.
///
/// The planned account list is `lz_receive`'s own accounts, then the remaining accounts in the
/// layout [`crate::ReceiveAccounts`] parses: Endpoint `clear`, the gate group, hook groups,
/// compose groups.
#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceiveTypesV3<'info> {
    /// Keep `payer` and `plan_out` first: `lz_receive_types_info` drops those two leading slots.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Ephemeral scratch the caller creates and signs for; `oapp::lz_plan` validates it.
    #[account(mut)]
    pub plan_out: Signer<'info>,

    pub oft_store: Account<'info, OFTStore>,

    #[account(
        seeds = OFTStore::oft_escrow_seeds(&oft_store.key()),
        bump,
        token::authority = oft_store,
        token::mint = token_mint,
    )]
    pub oft_escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        address = oft_store.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: The recipient's ATA, which may not exist yet; address enforced by the constraint.
    #[account(
        address = get_associated_token_address_with_program_id(
            &Pubkey::from(codec::msg::send_to(&params.message)?),
            &oft_store.token_mint,
            &token_program.key(),
        ) @ OFTError::InvalidTokenDest
    )]
    pub token_dest: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: The mint's hook manifest, required when it has a hook; its canonical address is
    /// checked against the hook program read from the mint.
    pub extra_account_meta_list: Option<UncheckedAccount<'info>>,

    /// CHECK: The selected pubkey policy, required when one is selected. Only its owner is read:
    /// that program derives the recipient's record address.
    pub pubkey_policy: Option<UncheckedAccount<'info>>,

    /// CHECK: The mint's Token ACL MintConfig, required when ACL applies; read for the gate it
    /// names.
    pub acl_mint_config: Option<UncheckedAccount<'info>>,

    /// CHECK: The thaw manifest of the gate `OFTStore.acl_gating_program` caches, required when
    /// ACL applies; it must be the configured gate's (`acl::ThawPlan`), so a stale
    /// cache fails planning until `sync_acl_gating_program`.
    pub acl_thaw_metas: Option<UncheckedAccount<'info>>,

    /// CHECK: The configured redirect escrow, required when redirect is configured
    /// (`resolve_redirect_escrow`).
    pub redirect_escrow: Option<UncheckedAccount<'info>>,
}

impl LzReceiveTypesV3<'_> {
    pub fn apply(ctx: &mut Context<LzReceiveTypesV3>, params: &LzReceiveParams) -> Result<u32> {
        let redirect = resolve_redirect_escrow(
            ctx.accounts.oft_store.credit_redirect_config,
            ctx.accounts.redirect_escrow.as_ref(),
        )?;
        let to_address = Pubkey::from(codec::msg::send_to(&params.message)?);
        let amount_ld = ctx.accounts.oft_store.sd2ld(codec::msg::amount_sd(&params.message)?)?;
        let compose_message = codec::msg::compose_msg_with_sender(&params.message)?;

        let (mut accounts, gate) = Self::lz_receive_accounts(ctx, params, to_address)?;
        accounts.extend(get_accounts_for_clear(
            ENDPOINT_ID,
            &ctx.accounts.oft_store.key(),
            params.src_eid,
            &params.sender,
            params.nonce,
        ));
        if let Some(gate) = gate {
            Self::append_gate_accounts(&mut accounts, ctx, &gate, to_address)?;
        }
        Self::append_remaining_accounts(
            &mut accounts,
            ctx,
            params,
            to_address,
            redirect.as_ref(),
            amount_ld,
            compose_message,
        )?;

        // Receive creates the ATA and decides thaw and redirect at execution time; the plan names
        // the inputs for every outcome rather than snapshotting those decisions.
        let plan = LzReceiveTypesV3Result {
            context_version: EXECUTION_CONTEXT_VERSION_1,
            instructions: vec![Instruction::LzReceive { accounts }],
        };
        lz_plan::write(ctx.program_id, &ctx.accounts.plan_out, &plan)
    }

    /// `lz_receive`'s accounts, from its generated client struct so their order and writability
    /// follow the `LzReceive` definition, and the gate when ACL applies. Omitted optionals become
    /// Anchor's read-only program-ID sentinel; the payer slot is left to the executor.
    fn lz_receive_accounts(
        ctx: &Context<LzReceiveTypesV3>,
        params: &LzReceiveParams,
        to_address: Pubkey,
    ) -> Result<(Vec<AccountMetaRef>, Option<Pubkey>)> {
        let a = &ctx.accounts;
        let oft_store = a.oft_store.key();
        let mint = a.token_mint.key();
        let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, ctx.program_id).0;
        // The selected policy and the recipient's record are named, not evaluated: only execution
        // decides. The policy's owner is the program its records live under.
        let policy = match (a.oft_store.pubkey_policy, a.pubkey_policy.as_ref()) {
            (None, None) => None,
            (Some(selected), Some(account)) if account.key() == selected => {
                Some((selected, *account.owner))
            },
            _ => return err!(OFTError::InvalidPubkeyPolicy),
        };
        // No ACL inputs without screening, even on an ACL-governed mint.
        let needs_acl = acl::requires_acl(&mint, a.token_mint.freeze_authority, policy.is_some());
        let gate = match (needs_acl, a.acl_mint_config.as_ref()) {
            (false, _) => None,
            (true, Some(config)) => {
                Some(acl::read_mint_config(config, &mint).map_err(map_acl_error)?.gating_program)
            },
            (true, None) => return err!(OFTError::InvalidAclAccounts),
        };
        let accounts = crate::accounts::LzReceive {
            payer: Pubkey::default(),
            oft_store,
            peer: pda(OAppPeer::seeds(&oft_store, params.src_eid)),
            default_rate_limit: pda(RateLimit::seeds(&oft_store, DEFAULT_RATE_LIMIT_ID)),
            rate_limit: pda(RateLimit::seeds(&oft_store, params.src_eid)),
            address_exemption: pda(RateLimitAddressExemption::seeds(&oft_store, &to_address)),
            oft_escrow: a.oft_escrow.key(),
            to_address,
            token_dest: a.token_dest.key(),
            redirect_escrow: a.redirect_escrow.as_ref().map(|escrow| escrow.key()),
            pubkey_policy: policy.map(|(policy, _)| policy),
            pubkey_policy_record: policy.map(|(policy, program)| {
                pubkey_policy_interface::subject_address_in(&policy, &to_address, &program).0
            }),
            token_mint: mint,
            mint_authority: a.token_mint.mint_authority.into(),
            token_program: a.token_program.key(),
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
            acl_mint_config: needs_acl.then(|| acl::mint_config_address(&mint)),
            acl_thaw_metas: gate.map(|gate| acl::thaw_metas_address(&mint, &gate)),
            acl_flag: needs_acl.then(|| acl::flag_address(&a.token_dest.key())),
            acl_program: needs_acl.then_some(acl::TOKEN_ACL_ID),
            acl_gate_program: gate,
            event_authority: pda(&[EVENT_SEED]),
            program: *ctx.program_id,
        };
        let mut metas: Vec<AccountMetaRef> = accounts
            .to_account_metas(None)
            .into_iter()
            .map(|meta| AccountMetaRef {
                pubkey: meta.pubkey.into(),
                is_writable: meta.is_writable,
            })
            .collect();
        // `payer` is `LzReceive`'s first field: the placeholder above becomes the executor's payer.
        debug_assert!(metas[0].pubkey == AddressLocator::from(Pubkey::default()));
        metas[0] = AccountMetaRef { pubkey: AddressLocator::Payer, is_writable: true };
        Ok((metas, gate))
    }

    /// The gate group: the extra accounts `gate`'s thaw manifest names, resolved for the
    /// recipient's ATA as Token ACL will resolve them. Nothing here depends on the gate's layout.
    fn append_gate_accounts(
        accounts: &mut Vec<AccountMetaRef>,
        ctx: &Context<LzReceiveTypesV3>,
        gate: &Pubkey,
        to_address: Pubkey,
    ) -> Result<()> {
        let a = &ctx.accounts;
        let manifest = a.acl_thaw_metas.as_ref().ok_or(OFTError::InvalidAclThawMetas)?;
        let token_dest = a.token_dest.to_account_info();
        let data = token_dest.try_borrow_data()?;
        // An ATA not created yet resolves from the fields its seeds may read, as for hooks.
        let synthetic = token_account_seed_prefix(a.token_mint.key(), to_address);
        let extras = acl::ThawPlan {
            manifest,
            mint: &a.token_mint.to_account_info(),
            gate,
            token_account: token_dest.key,
            token_account_data: if data.is_empty() { &synthetic } else { &data },
            owner: &to_address,
        }
        .extras()
        .map_err(map_acl_error)?;
        accounts.extend(extras.into_iter().map(|meta| AccountMetaRef {
            pubkey: meta.pubkey.into(),
            is_writable: meta.is_writable,
        }));
        Ok(())
    }

    /// Appends the hook group for each credit destination, then their compose groups, in the
    /// layout [`crate::ReceiveAccounts`] parses. Each compose group encodes the amount that
    /// destination reports as received ([`delivered_amount`]).
    fn append_remaining_accounts(
        accounts: &mut Vec<AccountMetaRef>,
        ctx: &Context<LzReceiveTypesV3>,
        params: &LzReceiveParams,
        to_address: Pubkey,
        redirect: Option<&AccountInfo>,
        amount_ld: u64,
        compose_message: Option<&[u8]>,
    ) -> Result<()> {
        if let Some(hook) = get_transfer_hook_program_id(&ctx.accounts.token_mint)? {
            let recipient = ctx.accounts.token_dest.to_account_info();
            Self::append_credit_hook_group(
                accounts, ctx, &hook, &recipient, to_address, amount_ld,
            )?;
            if let Some(redirect) = redirect {
                Self::append_credit_hook_group(
                    accounts, ctx, &hook, redirect, to_address, amount_ld,
                )?;
            }
        }
        let oft_store = &ctx.accounts.oft_store;
        let compose = |accounts: &mut Vec<AccountMetaRef>, amount_received_ld| {
            Self::append_compose_accounts(
                accounts,
                oft_store,
                params,
                to_address,
                amount_received_ld,
                compose_message,
            )
        };
        compose(accounts, delivered_amount(false, amount_ld));
        if redirect.is_some() {
            compose(accounts, delivered_amount(true, amount_ld));
        }
        Ok(())
    }

    /// One credit destination's transfer-hook group, resolved against that destination.
    fn append_credit_hook_group(
        accounts: &mut Vec<AccountMetaRef>,
        ctx: &Context<LzReceiveTypesV3>,
        hook_program: &Pubkey,
        credit_to: &AccountInfo,
        recipient: Pubkey,
        amount_ld: u64,
    ) -> Result<()> {
        let meta_list = ctx
            .accounts
            .extra_account_meta_list
            .as_ref()
            .ok_or(OFTError::InvalidExtraAccountMetaList)?
            .to_account_info();

        // Only the recipient's own ATA may be planned before it exists; a redirect escrow is
        // configured ahead of time and must already carry real data. The redirect group is planned
        // for every message, so a closed escrow fails planning even for plain deliveries.
        let synthetic_destination = if credit_to.data_is_empty() {
            require_keys_eq!(
                credit_to.key(),
                ctx.accounts.token_dest.key(),
                OFTError::InvalidRedirectEscrow
            );
            Some(token_account_seed_prefix(ctx.accounts.token_mint.key(), recipient))
        } else {
            None
        };

        let destination_data = credit_to.try_borrow_data()?;
        append_transfer_hook_accounts(
            accounts,
            hook_program,
            &ctx.accounts.oft_escrow.to_account_info(),
            &ctx.accounts.token_mint.to_account_info(),
            TransferHookDestination {
                key: credit_to.key(),
                data: synthetic_destination
                    .as_ref()
                    .map_or(destination_data.as_ref(), |bytes| bytes.as_slice()),
            },
            &ctx.accounts.oft_store.to_account_info(),
            &meta_list,
            amount_ld,
        )
    }

    fn append_compose_accounts(
        accounts: &mut Vec<AccountMetaRef>,
        oft_store: &Account<OFTStore>,
        params: &LzReceiveParams,
        to_address: Pubkey,
        amount_received_ld: u64,
        compose_message: Option<&[u8]>,
    ) {
        if let Some(compose_message) = compose_message {
            accounts.extend(get_accounts_for_send_compose(
                ENDPOINT_ID,
                &oft_store.key(),
                &to_address,
                &params.guid,
                0,
                &codec::compose_msg::encode(
                    params.nonce,
                    params.src_eid,
                    amount_received_ld,
                    compose_message,
                ),
            ));
        }
    }
}
