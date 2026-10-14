use crate::{
    codec, delivered_amount, events::CreditRedirected, inflow, map_acl_error,
    resolve_pubkey_policy, resolve_redirect_escrow, serialize_into_owned_unchecked_account,
    transfer_fee_active, MintTransferHook, OAppPeer, OFTError, OFTStore, RateLimit,
    RateLimitAddressExemption, ReceiveAccounts, DEFAULT_RATE_LIMIT_ID,
};
use anchor_lang::{prelude::*, solana_program::program_option::COption};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use oapp::{
    endpoint::{
        types::{ClearParams, SendComposeParams},
        ID as ENDPOINT_ID,
    },
    endpoint_cpi,
    types::LzReceiveParams,
    utils::try_load_account,
    OAppState,
};
use oft::{events::OFTReceived, types::OftType};
use pubkey_policy_interface::ValidatedPubkeyPolicy;
use spl_token_2022::onchain::invoke_transfer_checked;
use token_manager_interface::acl::{self, ThawAccounts};

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceive<'info> {
    /// Keep `payer` first: the planner hands that slot to the executor's payer.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub oft_store: Box<Account<'info, OFTStore>>,

    #[account(
        seeds = OAppPeer::seeds(&oft_store.key(), params.src_eid),
        bump = peer.bump,
        constraint = peer.address == params.sender @OFTError::InvalidSender
    )]
    pub peer: Box<Account<'info, OAppPeer>>,

    /// Default rate limiter PDA (id=0), used for fallback config and global state.
    #[account(
        mut,
        seeds = RateLimit::seeds(&oft_store.key(), DEFAULT_RATE_LIMIT_ID),
        bump
    )]
    pub default_rate_limit: Box<Account<'info, RateLimit>>,

    /// CHECK: Per-EID rate limiter PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account and manually persisted by the handler after mutation.
    #[account(
        mut,
        seeds = RateLimit::seeds(&oft_store.key(), params.src_eid),
        bump
    )]
    pub rate_limit: UncheckedAccount<'info>,

    /// CHECK: Address exemption PDA for the recipient. Seeds validated by Anchor; existence
    /// checked via data_is_empty(). Not Option<Account<T>> — the client must always pass the
    /// correct PDA so the program (not the client) determines whether the exemption exists.
    #[account(
        seeds = RateLimitAddressExemption::seeds(&oft_store.key(), &to_address.key()),
        bump
    )]
    pub address_exemption: UncheckedAccount<'info>,

    // Boxed to reduce stack frame size (BPF limit: 4096 bytes)
    #[account(
        mut,
        seeds = OFTStore::oft_escrow_seeds(&oft_store.key()),
        bump,
        token::authority = oft_store,
        token::mint = token_mint
    )]
    pub oft_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: the wallet address to receive the token
    #[account(address = Pubkey::from(codec::msg::send_to(&params.message)?) @OFTError::InvalidTokenDest)]
    pub to_address: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = to_address,
        associated_token::token_program = token_program
    )]
    pub token_dest: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: The configured redirect escrow, required when redirect is configured
    /// (`resolve_redirect_escrow`). Checked by address only: Token-2022 validates it when it is
    /// actually credited, so here a closed escrow fails only redirects. On a transfer-hook mint
    /// the planner rejects a closed escrow for every message (`lz_receive_types_v3`). It may be
    /// the recipient's own account (plain delivery).
    #[account(mut)]
    pub redirect_escrow: Option<UncheckedAccount<'info>>,

    /// CHECK: The selected pubkey policy; presence, key and mint are checked by
    /// `resolve_pubkey_policy`.
    pub pubkey_policy: Option<UncheckedAccount<'info>>,

    /// CHECK: The recipient's canonical subject record; `ValidatedPubkeyPolicy::read` checks it.
    pub pubkey_policy_record: Option<UncheckedAccount<'info>>,

    #[account(
        mut,
        address = oft_store.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    // Only used for BurnMint, the mint authority can be:
    //      1. a spl-token multisig account with oft_store as one of the signers, and the quorum
    //         **MUST** be 1-of-n. (recommended)
    //      2. or the mint_authority is oft_store itself.
    #[account(constraint = token_mint.mint_authority == COption::Some(mint_authority.key()) @OFTError::InvalidMintAuthority)]
    pub mint_authority: Option<UncheckedAccount<'info>>,

    pub token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

    // The five `acl_*` accounts are required when `acl::requires_acl`; the planner omits them
    // otherwise. The gate's own extra accounts are the remaining accounts' gate group.
    /// CHECK: Token ACL's MintConfig for this mint; address checked by `acl::read_mint_config`.
    pub acl_mint_config: Option<UncheckedAccount<'info>>,

    /// CHECK: The configured gate's thaw manifest, which sizes the gate group; its address is
    /// checked against the config's gate by `acl::thaw_extra_count`. Token ACL resolves the gate's
    /// extra accounts from it again.
    pub acl_thaw_metas: Option<UncheckedAccount<'info>>,

    /// CHECK: Native ACL's transient flag for `token_dest`, which ACL derives and checks itself.
    #[account(mut)]
    pub acl_flag: Option<UncheckedAccount<'info>>,

    /// CHECK: Fixed native ACL executable; never caller-selected.
    #[account(address = acl::TOKEN_ACL_ID @ OFTError::InvalidAclAccounts, executable)]
    pub acl_program: Option<UncheckedAccount<'info>>,

    /// CHECK: The gate the MintConfig names; Token ACL checks it against its config.
    pub acl_gate_program: Option<UncheckedAccount<'info>>,
}

impl<'info> LzReceive<'info> {
    pub fn apply(
        ctx: &mut Context<'info, LzReceive<'info>>,
        params: &LzReceiveParams,
    ) -> Result<()> {
        let redirect_escrow = resolve_redirect_escrow(
            ctx.accounts.oft_store.credit_redirect_config,
            ctx.accounts.redirect_escrow.as_ref(),
        )?;
        let redirect_enabled = redirect_escrow.is_some();

        // Validate the policy accounts even when `token_dest` is already frozen. Anchor has created
        // a missing ATA, so the checks below see its live state.
        let policy = resolve_pubkey_policy(
            &ctx.accounts.oft_store,
            ctx.accounts.pubkey_policy.as_ref(),
            ctx.accounts.pubkey_policy_record.as_ref(),
            &ctx.accounts.to_address.key(),
        )?;
        // Screening off: nothing to activate, even on an ACL-governed mint, because the policy is
        // what predicts the gate's answer.
        let a = &ctx.accounts;
        let gate_extras = match &policy {
            Some(_)
                if acl::requires_acl(&a.token_mint.key(), a.token_mint.freeze_authority, true) =>
            {
                Some(Self::gate_extra_count(a)?)
            },
            _ => None,
        };
        if let (Some(policy), Some(gate_extras)) = (&policy, gate_extras) {
            let gate = ReceiveAccounts::gate(ctx.remaining_accounts, gate_extras)?;
            Self::activate_recipient(ctx, policy, gate)?;
        }
        let policy_blocked = policy.as_ref().is_some_and(ValidatedPubkeyPolicy::is_blocked);
        // A `token_dest` still frozen here is a genuine hold and may be redirected; missing or
        // malformed ACL inputs and native CPI failures have already aborted above.
        let frozen = ctx.accounts.token_dest.is_frozen();

        let credit_to = match (frozen || policy_blocked, redirect_escrow) {
            (false, _) => ctx.accounts.token_dest.to_account_info(),
            (true, Some(escrow)) => escrow,
            (true, None) => return err!(OFTError::CreditBlocked),
        };
        // An escrow that is also the recipient's own account is plain delivery, not a redirect.
        let redirected = credit_to.key() != ctx.accounts.token_dest.key();

        let has_compose = codec::msg::compose_msg_with_sender(&params.message)?.is_some();
        let amount_ld = ctx.accounts.oft_store.sd2ld(codec::msg::amount_sd(&params.message)?)?;
        let accounts = ReceiveAccounts::parse(
            &MintTransferHook::read(&ctx.accounts.token_mint)?,
            ctx.remaining_accounts,
            gate_extras.unwrap_or(0),
            has_compose,
            redirect_enabled,
        )?;

        Self::clear_payload(&ctx.accounts.oft_store, params, accounts.clear)?;

        let candidate = accounts.candidate(redirected)?;
        let amount_received_ld = Self::credit(
            ctx,
            params,
            amount_ld,
            credit_to,
            redirected,
            candidate.hooks.cpi_accounts(),
        )?;

        Self::send_compose_if_needed(
            &ctx.accounts.oft_store,
            ctx.accounts.to_address.key(),
            params,
            amount_received_ld,
            candidate.compose,
        )?;

        emit_cpi!(OFTReceived {
            oft_store: ctx.accounts.oft_store.key(),
            guid: params.guid,
            src_eid: params.src_eid,
            to: ctx.accounts.to_address.key(),
            amount_received_ld,
        });
        Ok(())
    }

    fn clear_payload(
        oft_store: &Account<OFTStore>,
        params: &LzReceiveParams,
        clear_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        endpoint_cpi::clear(
            ENDPOINT_ID,
            oft_store.key(),
            clear_accounts,
            &oft_store.signer_seeds(),
            ClearParams {
                receiver: oft_store.key(),
                src_eid: params.src_eid,
                sender: params.sender,
                nonce: params.nonce,
                guid: params.guid,
                message: params.message.clone(),
            },
        )?;
        Ok(())
    }

    /// How many extra accounts the configured gate's thaw manifest names: the gate group's length.
    fn gate_extra_count(a: &LzReceive<'info>) -> Result<usize> {
        acl::thaw_extra_count(
            a.acl_mint_config.as_ref().ok_or(OFTError::InvalidAclAccounts)?,
            a.acl_thaw_metas.as_ref().ok_or(OFTError::InvalidAclThawMetas)?,
            &a.token_mint.key(),
        )
        .map_err(map_acl_error)
    }

    /// On a mint that requires ACL, thaws a frozen `token_dest` through Token ACL if the
    /// recipient is eligible, then reloads it. `gate` is the gate group.
    fn activate_recipient(
        ctx: &mut Context<'info, LzReceive<'info>>,
        policy: &ValidatedPubkeyPolicy,
        gate: &[AccountInfo<'info>],
    ) -> Result<()> {
        let a = &ctx.accounts;
        let thawed = ThawAccounts {
            payer: &a.payer.to_account_info(),
            mint: &a.token_mint.to_account_info(),
            token_account: &a.token_dest.to_account_info(),
            owner: &a.to_address.to_account_info(),
            config: a.acl_mint_config.as_ref().ok_or(OFTError::InvalidAclAccounts)?,
            manifest: a.acl_thaw_metas.as_ref().ok_or(OFTError::InvalidAclThawMetas)?,
            flag: a.acl_flag.as_ref().ok_or(OFTError::InvalidAclAccounts)?,
            acl_program: a.acl_program.as_ref().ok_or(OFTError::InvalidAclAccounts)?,
            gate_program: a.acl_gate_program.as_ref().ok_or(OFTError::InvalidAclAccounts)?,
            token_program: &a.token_program.to_account_info(),
            system_program: &a.system_program.to_account_info(),
        }
        .thaw_if_eligible(policy, gate)
        .map_err(map_acl_error)?;
        if thawed {
            ctx.accounts.token_dest.reload()?;
        }
        Ok(())
    }

    /// EVM `_credit`: rate-limit and deliver `amount_ld` to `credit_to`, returning the amount
    /// reported as received ([`delivered_amount`]). Assumes lossless transfers: a non-zero transfer
    /// fee is refused, since the recipient would get less than the amount reported to a composer;
    /// rebasing is unsupported.
    fn credit(
        ctx: &mut Context<'info, LzReceive<'info>>,
        params: &LzReceiveParams,
        amount_ld: u64,
        credit_to: AccountInfo<'info>,
        redirected: bool,
        hook_accounts: &[AccountInfo<'info>],
    ) -> Result<u64> {
        require!(!transfer_fee_active(&ctx.accounts.token_mint)?, OFTError::TransferFeeActive);
        Self::apply_inflow(ctx, amount_ld)?;

        if redirected {
            emit_cpi!(CreditRedirected {
                oft_store: ctx.accounts.oft_store.key(),
                guid: params.guid,
                recipient: ctx.accounts.to_address.key(),
                token_dest: ctx.accounts.token_dest.key(),
                redirect_escrow: credit_to.key(),
                amount_ld,
            });
        }

        Self::mint_or_unlock(ctx, amount_ld, credit_to, hook_accounts)?;

        Ok(delivered_amount(redirected, amount_ld))
    }

    fn apply_inflow(ctx: &mut Context<'info, LzReceive<'info>>, amount_ld: u64) -> Result<()> {
        let is_address_exempt = !ctx.accounts.address_exemption.data_is_empty();
        let mut rate_limit: Option<RateLimit> = try_load_account(&ctx.accounts.rate_limit)?;
        inflow(
            &ctx.accounts.oft_store,
            &mut ctx.accounts.default_rate_limit,
            rate_limit.as_mut(),
            amount_ld,
            is_address_exempt,
        )?;
        serialize_into_owned_unchecked_account(&ctx.accounts.rate_limit, rate_limit.as_ref())
    }

    /// Deliver `amount_ld` to `credit_to` — the pair of `lock_or_burn` on the send side.
    /// For `BurnMint`, mint into the escrow first; for `LockUnlock` the escrow already holds the
    /// locked balance. Either way the escrow → `credit_to` transfer runs the mint's transfer hook,
    /// if any.
    ///
    /// `hook_accounts` is the native CPI slice from [`crate::TransferHookAccounts`], not the wire
    /// group: an unallocated manifest witness has already been consumed and removed.
    fn mint_or_unlock(
        ctx: &mut Context<'info, LzReceive<'info>>,
        amount_ld: u64,
        credit_to: AccountInfo<'info>,
        hook_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        let seeds = &ctx.accounts.oft_store.signer_seeds();
        if ctx.accounts.oft_store.oft_type == OftType::BurnMint {
            let Some(mint_authority) = &ctx.accounts.mint_authority else {
                return Err(OFTError::InvalidMintAuthority.into());
            };
            let ix = spl_token_2022_interface::instruction::mint_to(
                ctx.accounts.token_program.key,
                &ctx.accounts.token_mint.key(),
                &ctx.accounts.oft_escrow.key(),
                mint_authority.key,
                &[&ctx.accounts.oft_store.key()],
                amount_ld,
            )?;
            anchor_lang::solana_program::program::invoke_signed(
                &ix,
                &[
                    ctx.accounts.oft_escrow.to_account_info(),
                    ctx.accounts.token_mint.to_account_info(),
                    mint_authority.to_account_info(),
                    ctx.accounts.oft_store.to_account_info(),
                ],
                &[seeds],
            )?;
        }

        invoke_transfer_checked(
            ctx.accounts.token_program.key,
            ctx.accounts.oft_escrow.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            credit_to,
            ctx.accounts.oft_store.to_account_info(),
            hook_accounts,
            amount_ld,
            ctx.accounts.token_mint.decimals,
            &[seeds],
        )?;
        Ok(())
    }

    /// Send compose message if present in the original message.
    fn send_compose_if_needed(
        oft_store: &Account<OFTStore>,
        to_address: Pubkey,
        params: &LzReceiveParams,
        amount_received_ld: u64,
        compose_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        if let Some(message) = codec::msg::compose_msg_with_sender(&params.message)? {
            endpoint_cpi::send_compose(
                ENDPOINT_ID,
                oft_store.key(),
                compose_accounts,
                &oft_store.signer_seeds(),
                SendComposeParams {
                    to: to_address,
                    guid: params.guid,
                    index: 0,
                    message: codec::compose_msg::encode(
                        params.nonce,
                        params.src_eid,
                        amount_received_ld,
                        message,
                    ),
                },
            )?;
        }
        Ok(())
    }
}
