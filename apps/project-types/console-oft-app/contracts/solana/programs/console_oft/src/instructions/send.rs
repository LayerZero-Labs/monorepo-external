use crate::{
    codec, combine_options,
    instructions::fee_config,
    mint_supply, msg_type, outflow, pause, permissioned_burn_active,
    seeds::ESCROW_SEED,
    serialize_into_owned_unchecked_account,
    state::{PauseConfig, RateLimitAddressExemption},
    transfer_fee_active, EnforcedOptions, FeeConfig, MintTransferHook, OAppPeer, OFTError,
    OFTStore, RateLimit, TransferHookAccounts, DEFAULT_RATE_LIMIT_ID,
};
use anchor_lang::{prelude::*, solana_program::program::invoke_signed};
use anchor_spl::token_interface::{self, Approve, Burn, Mint, TokenAccount, TokenInterface};
use oapp::{
    endpoint::{
        types::{MessagingReceipt, SendParams as EndpointSendParams},
        ID as ENDPOINT_ID,
    },
    endpoint_cpi,
    utils::try_load_account,
    OAppState as _,
};
use oft::{
    events::OFTSent,
    types::{OFTReceipt, OftType, SendParams},
};
use spl_token_2022::onchain::invoke_transfer_checked;
use token_manager_interface::burn;

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: SendParams)]
pub struct Send<'info> {
    pub signer: Signer<'info>,

    pub oft_store: Box<Account<'info, OFTStore>>,

    // Boxed to reduce stack frame size (BPF limit: 4096 bytes)
    #[account(
        seeds = OAppPeer::seeds(&oft_store.key(), params.dst_eid),
        bump = peer.bump
    )]
    pub peer: Box<Account<'info, OAppPeer>>,

    /// CHECK: Enforced options PDA selected by compose_msg presence. Seeds validated by Anchor;
    /// deserialized via try_load_account in handler.
    #[account(
        seeds = EnforcedOptions::seeds(
            &oft_store.key(),
            params.dst_eid,
            msg_type(params.compose_msg.as_deref()).into(),
        ),
        bump
    )]
    pub enforced_options: UncheckedAccount<'info>,

    /// CHECK: Per-EID pause config PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Not Option<Account<T>> — the client must always pass the correct PDA
    /// so the program (not the client) determines whether the config is initialized.
    #[account(
        seeds = PauseConfig::seeds(&oft_store.key(), params.dst_eid),
        bump
    )]
    pub pause_config: UncheckedAccount<'info>,

    /// CHECK: Per-EID fee config PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Not Option<Account<T>> — the client must always pass the correct PDA
    /// so the program (not the client) determines whether the config is initialized.
    #[account(
        seeds = FeeConfig::seeds(&oft_store.key(), params.dst_eid),
        bump
    )]
    pub fee_config: UncheckedAccount<'info>,

    /// Default rate limiter PDA (id=0), used for fallback config and global state.
    #[account(
        mut,
        seeds = RateLimit::seeds(&oft_store.key(), DEFAULT_RATE_LIMIT_ID),
        bump
    )]
    pub default_rate_limit: Account<'info, RateLimit>,

    /// CHECK: Per-EID rate limiter PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account and manually persisted by the handler after mutation.
    #[account(
        mut,
        seeds = RateLimit::seeds(&oft_store.key(), params.dst_eid),
        bump
    )]
    pub rate_limit: UncheckedAccount<'info>,

    /// CHECK: Address exemption PDA for the sender. Seeds validated by Anchor; existence checked
    /// via data_is_empty(). Not Option<Account<T>> — the client must always pass the correct PDA
    /// so the program (not the client) determines whether the exemption exists.
    #[account(
        seeds = RateLimitAddressExemption::seeds(&oft_store.key(), &signer.key()),
        bump
    )]
    pub address_exemption: UncheckedAccount<'info>,

    // Boxed to reduce stack frame size (BPF limit: 4096 bytes)
    #[account(
        mut,
        token::authority = signer,
        token::mint = token_mint
    )]
    pub token_source: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = OFTStore::oft_escrow_seeds(&oft_store.key()),
        bump,
        token::authority = oft_store.key(),
        token::mint = token_mint
    )]
    pub oft_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Optional when the collected fee (including decimal dust) is zero. Supplied accounts
    /// are always validated; use Anchor's None sentinel to omit an unusable deposit.
    #[account(
        mut,
        address = oft_store.fee_deposit,
        token::mint = token_mint
    )]
    pub fee_deposit: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    #[account(
        mut,
        address = oft_store.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,

    // The four `burn_*` accounts are required only while the mint's PermissionedBurn is active.
    /// CHECK: The accepted TokenManager root (`OFTStore.token_manager`). The manager checks it is
    /// for this mint; Token-2022 checks its PB signer is the mint's PB authority.
    pub burn_policy: Option<UncheckedAccount<'info>>,
    /// CHECK: `oft_escrow`'s Burner role member on `burn_policy`, checked by the manager.
    pub burn_role: Option<UncheckedAccount<'info>>,
    /// CHECK: The program that owns `burn_policy`. It is invoked with only the escrow's signature,
    /// never `oft_store`'s.
    pub burn_manager: Option<UncheckedAccount<'info>>,
    /// CHECK: `burn_policy`'s PB signer PDA; the manager checks its seeds.
    pub burn_signer: Option<UncheckedAccount<'info>>,
}

impl<'info> Send<'info> {
    /// EVM parity: mirrors `_send` in OFTCoreBaseUpgradeable.sol.
    /// pause → debit (_debitView + _outflow + _burnAndCollectFee) → _lzSend → emit
    pub fn apply(
        ctx: &mut Context<'info, Send<'info>>,
        params: &SendParams,
    ) -> Result<(MessagingReceipt, OFTReceipt)> {
        // 1. Pause check (EVM: whenNotPaused modifier)
        let pause_config = try_load_account(&ctx.accounts.pause_config)?;
        require!(
            !pause::is_paused(ctx.accounts.oft_store.default_paused, pause_config.as_ref()),
            OFTError::Paused
        );

        // 2. Debit: _debitView + _outflow + _burnAndCollectFee
        let (amount_sent_ld, amount_received_ld, endpoint_accounts) =
            Self::debit(ctx, params.amount_ld, params.min_amount_ld)?;

        // 3. _lzSend
        let msg_receipt =
            Self::send_lz_message(ctx, params, amount_received_ld, endpoint_accounts)?;

        // 4. Emit event
        emit_cpi!(OFTSent {
            oft_store: ctx.accounts.oft_store.key(),
            guid: msg_receipt.guid,
            dst_eid: params.dst_eid,
            sender: ctx.accounts.signer.key(),
            from: ctx.accounts.token_source.key(),
            amount_sent_ld,
            amount_received_ld
        });

        Ok((msg_receipt, OFTReceipt { amount_sent_ld, amount_received_ld }))
    }

    /// EVM alignment: `_debit` in OFTBurnMintExtended / OFTLockUnlockExtended
    /// (`_debitView` → `_outflow` → `_burnAndCollectFee`).
    ///
    /// `_burnAndCollectFee` is split into:
    ///   - `lock_or_burn`: source → escrow (`amount_sent_ld`), then burn `amount_received_ld` if
    ///     `BurnMint` (no-op for `LockUnlock` — funds stay locked).
    ///   - `collect_fee`:  escrow → fee_deposit (`fee_ld`), if any.
    ///
    /// # Warning
    /// This implementation assumes lossless token transfers:
    ///   - Token2022 transfer fees > 0 are refused ([`OFTError::TransferFeeActive`]): the amount
    ///     that lands in escrow would be less than `amount_sent_ld`, desynchronising escrow balance
    ///     accounting and the cross-chain amount.
    ///   - Rebalancing / rebasing tokens: any supply adjustment between lock and burn will corrupt
    ///     the escrow ledger in the same way.
    ///
    /// Supporting these tokens requires changes to both debit and credit accounting;
    /// this implementation does not reconcile actual balance changes.
    ///
    /// `ctx.remaining_accounts` layout:
    ///   - With fee:    [transfer_hook..., fee_hook..., endpoint...]
    ///   - Without fee: [transfer_hook..., endpoint...]
    ///
    /// Returns `(amount_sent_ld, amount_received_ld, endpoint_accounts)`.
    fn debit(
        ctx: &mut Context<'info, Send<'info>>,
        amount_ld: u64,
        min_amount_ld: u64,
    ) -> Result<(u64, u64, &'info [AccountInfo<'info>])> {
        require!(!transfer_fee_active(&ctx.accounts.token_mint)?, OFTError::TransferFeeActive);

        // 1. Compute amounts (EVM: _debitView)
        let fee_config = try_load_account(&ctx.accounts.fee_config)?;
        let (amount_sent_ld, amount_received_ld) =
            debit_view(&ctx.accounts.oft_store, fee_config.as_ref(), amount_ld, min_amount_ld)?;
        let fee_ld = amount_sent_ld - amount_received_ld;

        // 2. Rate limit outflow (EVM: _outflow)
        let is_address_exempt = !ctx.accounts.address_exemption.data_is_empty();
        let mut rate_limit: Option<RateLimit> = try_load_account(&ctx.accounts.rate_limit)?;
        outflow(
            &ctx.accounts.oft_store,
            &mut ctx.accounts.default_rate_limit,
            rate_limit.as_mut(),
            amount_received_ld,
            is_address_exempt,
        )?;
        serialize_into_owned_unchecked_account(&ctx.accounts.rate_limit, rate_limit.as_ref())?;

        // 3. Lock or burn + collect fee (EVM: _burnAndCollectFee)
        let hook = MintTransferHook::read(&ctx.accounts.token_mint)?;
        let (lock_hooks, rest) = TransferHookAccounts::take_prefix(&hook, ctx.remaining_accounts)?;
        Self::lock_or_burn(ctx, amount_sent_ld, amount_received_ld, lock_hooks.cpi_accounts())?;
        let endpoint_accounts = if fee_ld == 0 {
            rest
        } else {
            let (fee_hooks, rest) = TransferHookAccounts::take_prefix(&hook, rest)?;
            Self::collect_fee(ctx, fee_ld, fee_hooks.cpi_accounts())?;
            rest
        };
        Ok((amount_sent_ld, amount_received_ld, endpoint_accounts))
    }

    /// Move funds out of the sender (EVM: `safeTransferFrom(_from, address(this), amountSentLD)`).
    /// For `LockUnlock` the escrow holds the locked balance; for `BurnMint` the escrow is a
    /// transient hop — burn `amount_received_ld` so only the fee is left behind.
    fn lock_or_burn(
        ctx: &mut Context<'info, Send<'info>>,
        amount_sent_ld: u64,
        amount_received_ld: u64,
        hook_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        // Transfer full amount from sender to escrow.
        invoke_transfer_checked(
            ctx.accounts.token_program.key,
            ctx.accounts.token_source.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            ctx.accounts.oft_escrow.to_account_info(),
            ctx.accounts.signer.to_account_info(),
            hook_accounts,
            amount_sent_ld,
            ctx.accounts.token_mint.decimals,
            &[],
        )?;

        // For BurnMint, burn the amount that will be received on the other side so only the fee
        // remains in escrow. For LockUnlock, keep the full amount in escrow.
        if ctx.accounts.oft_store.oft_type == OftType::BurnMint {
            Self::burn_from_escrow(ctx, amount_received_ld)?;
        }
        Ok(())
    }

    /// Burn from the escrow. Without PermissionedBurn, `oft_store` burns as the escrow's owner
    /// through the token program. While it is active the burn goes through the accepted root's
    /// `permissioned_burn`, whose Burner-role approval Token-2022 requires.
    ///
    /// That manager is an admin-selected, upgradeable program, so it never receives `oft_store`'s
    /// signature (the mint authority and the OApp's identity). `oft_store` instead approves the
    /// escrow's own PDA as its delegate for exactly `amount`, and the manager gets only that
    /// signature. The supply check then rejects a manager that moved the approved tokens instead
    /// of burning them.
    ///
    /// The path follows [`permissioned_burn_active`], never which optional accounts were supplied.
    /// A substituted manager fails in Token-2022, which checks the approving signer is the mint's
    /// PB authority.
    fn burn_from_escrow(ctx: &Context<'info, Send<'info>>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        let signer_seeds = a.oft_store.signer_seeds();

        if permissioned_burn_active(&a.token_mint)? {
            let policy = a.burn_policy.as_ref().ok_or(OFTError::MissingBurnAccounts)?;
            let role = a.burn_role.as_ref().ok_or(OFTError::MissingBurnAccounts)?;
            let manager = a.burn_manager.as_ref().ok_or(OFTError::MissingBurnAccounts)?;
            require!(
                a.oft_store.token_manager == Some(policy.key()) && manager.key() == *policy.owner,
                OFTError::InvalidBurnAuthority
            );
            let signer = a.burn_signer.as_ref().ok_or(OFTError::MissingBurnAccounts)?;

            let escrow = a.oft_escrow.to_account_info();
            token_interface::approve(
                CpiContext::new_with_signer(
                    a.token_program.key(),
                    Approve {
                        to: escrow.clone(),
                        delegate: escrow.clone(),
                        authority: a.oft_store.to_account_info(),
                    },
                    &[&signer_seeds],
                ),
                amount,
            )?;

            let supply = mint_supply(&a.token_mint)?;
            let ix = burn::PermissionedBurn {
                authority: escrow.key(),
                token_manager: policy.key(),
                pb_signer: signer.key(),
                mint: a.token_mint.key(),
                token_account: escrow.key(),
                source_authority: escrow.key(),
                role_member: role.key(),
            }
            .instruction(manager.key(), amount);
            let store = a.oft_store.key();
            invoke_signed(
                &ix,
                &[
                    escrow,
                    policy.to_account_info(),
                    signer.to_account_info(),
                    a.token_mint.to_account_info(),
                    a.token_program.to_account_info(),
                    role.to_account_info(),
                    manager.to_account_info(),
                ],
                &[&[ESCROW_SEED, store.as_ref(), &[ctx.bumps.oft_escrow]]],
            )?;
            require!(
                supply.checked_sub(amount) == Some(mint_supply(&a.token_mint)?),
                OFTError::BurnNotApplied
            );
        } else {
            token_interface::burn(
                CpiContext::new_with_signer(
                    a.token_program.key(),
                    Burn {
                        mint: a.token_mint.to_account_info(),
                        from: a.oft_escrow.to_account_info(),
                        authority: a.oft_store.to_account_info(),
                    },
                    &[&signer_seeds],
                ),
                amount,
            )?;
        }
        Ok(())
    }

    /// EVM parity: `safeTransfer(feeDeposit(), amountSentLD - amountReceivedLD)`.
    /// Sweep the nonzero OFT fee left in escrow to `fee_deposit`.
    fn collect_fee(
        ctx: &Context<'info, Send<'info>>,
        fee_ld: u64,
        hook_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        let fee_deposit = ctx
            .accounts
            .fee_deposit
            .as_ref()
            .ok_or(OFTError::MissingFeeDeposit)?
            .to_account_info();

        invoke_transfer_checked(
            ctx.accounts.token_program.key,
            ctx.accounts.oft_escrow.to_account_info(),
            ctx.accounts.token_mint.to_account_info(),
            fee_deposit,
            ctx.accounts.oft_store.to_account_info(),
            hook_accounts,
            fee_ld,
            ctx.accounts.token_mint.decimals,
            &[&ctx.accounts.oft_store.signer_seeds()],
        )?;
        Ok(())
    }

    fn send_lz_message(
        ctx: &Context<Send<'info>>,
        params: &SendParams,
        amount_received_ld: u64,
        endpoint_accounts: &[AccountInfo<'info>],
    ) -> Result<MessagingReceipt> {
        let enforced_options = try_load_account::<EnforcedOptions>(&ctx.accounts.enforced_options)?;
        let amount_sd = ctx.accounts.oft_store.ld2sd(amount_received_ld);
        endpoint_cpi::send(
            ENDPOINT_ID,
            ctx.accounts.oft_store.key(),
            endpoint_accounts,
            &ctx.accounts.oft_store.signer_seeds(),
            EndpointSendParams {
                dst_eid: params.dst_eid,
                receiver: ctx.accounts.peer.get_address()?,
                message: codec::msg::encode(
                    params.to,
                    amount_sd,
                    ctx.accounts.signer.key(),
                    params.compose_msg.as_deref(),
                ),
                options: combine_options(enforced_options.as_ref(), &params.extra_options)?,
                native_fee: params.native_fee,
                lz_token_fee: params.lz_token_fee,
            },
        )
    }
}

/// EVM parity: `_debitView` in OFTCoreExtendedRBACUpgradeable.sol.
/// Returns `(amount_sent_ld, amount_received_ld)`. Fee is the difference.
pub fn debit_view(
    oft_store: &OFTStore,
    fee_config: Option<&FeeConfig>,
    amount_ld: u64,
    min_amount_ld: u64,
) -> Result<(u64, u64)> {
    let oft_fee = fee_config::get_oft_fee(oft_store.default_fee_bps, fee_config, amount_ld);
    let amount_received_ld = oft_store.remove_dust(amount_ld - oft_fee);

    require!(amount_received_ld >= min_amount_ld, OFTError::SlippageExceeded);
    Ok((amount_ld, amount_received_ld))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(ld2sd_rate: u64, default_fee_bps: u16) -> OFTStore {
        OFTStore {
            oft_type: OftType::LockUnlock,
            ld2sd_rate,
            shared_decimals: 6,
            token_mint: Pubkey::default(),
            initializer: Pubkey::default(),
            token_program: Pubkey::default(),
            bump: 0,
            transfer_hook_program: Pubkey::default(),
            acl_gating_program: Pubkey::default(),
            current_default_admin: Pubkey::default(),
            pending_default_admin: Pubkey::default(),
            default_paused: false,
            default_fee_bps,
            fee_deposit: Pubkey::default(),
            use_global_state: false,
            is_globally_disabled: false,
            credit_redirect_config: None,
            pubkey_policy: None,
            token_manager: None,
        }
    }

    /// The sender always pays the full amount; the fee and the shared-decimal dust left after
    /// it are both kept (and swept to `fee_deposit`), and only the rest crosses the chain.
    #[test]
    fn debit_charges_the_full_amount_and_sends_the_dust_free_remainder_after_fee() {
        // 1% of 12_345 is 123; 12_222 rounds down to 12_200 at a rate of 100.
        assert_eq!(debit_view(&store(100, 100), None, 12_345, 0).unwrap(), (12_345, 12_200));
        assert_eq!(
            debit_view(&store(100, 100), Some(&FeeConfig { fee_bps: 0 }), 12_345, 0).unwrap(),
            (12_345, 12_300)
        );
    }

    #[test]
    fn debit_rejects_a_received_amount_below_the_minimum() {
        assert!(debit_view(&store(100, 100), None, 12_345, 12_200).is_ok());
        assert_eq!(
            debit_view(&store(100, 100), None, 12_345, 12_201),
            Err(OFTError::SlippageExceeded.into())
        );
    }
}
