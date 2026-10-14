use crate::{
    events::{FeeDepositSet, RateLimitConfigUpdated},
    get_transfer_hook_program_id, OFTError, OFTStore, RateLimit, RoleMember, RoleType,
    DEFAULT_RATE_LIMIT_ID,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use oapp::{
    endpoint::{types::RegisterOAppParams, ID as ENDPOINT_ID},
    endpoint_cpi, OAppState,
};
use oft::{types::OftType, OFT_SEED};
use rbac::init_default_admin;

#[init_default_admin(state = oft_store, role_type = RoleType, payer = payer, admin = params.admin)]
#[derive(Accounts)]
#[instruction(params: InitConsoleOFTParams)]
pub struct InitConsoleOFT<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // Required signer whose pubkey seeds the OFTStore PDA. Enforces that
    // initializing an OFTStore at the PDA derived from `initializer.key()` requires
    // that initializer's signature — i.e. no one can create an OFTStore at someone
    // else's initializer-PDA without their key. Immutably stored in OFTStore and
    // never required to sign again.
    //
    // Recommended: use a fresh, throwaway keypair generated specifically for this
    // init call rather than reusing an existing wallet/onesig. Reusing the same
    // initializer across multiple OFT inits will fail with a PDA collision, since
    // the OFTStore PDA is derived solely from the initializer pubkey.
    pub initializer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + OFTStore::INIT_SPACE,
        seeds = [OFT_SEED, initializer.key().as_ref()],
        bump
    )]
    pub oft_store: Box<Account<'info, OFTStore>>,

    #[account(
        init,
        payer = payer,
        space = 8 + RateLimit::INIT_SPACE,
        seeds = RateLimit::seeds(&oft_store.key(), DEFAULT_RATE_LIMIT_ID),
        bump
    )]
    pub default_rate_limit: Box<Account<'info, RateLimit>>,

    #[account(
        mint::token_program = token_program,
        constraint = token_mint.decimals >= params.shared_decimals @ OFTError::InvalidDecimals,
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = OFTStore::oft_escrow_seeds(&oft_store.key()),
        bump,
        token::authority = oft_store,
        token::mint = token_mint
    )]
    pub oft_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Not owned by `oft_store`; see `SetFeeDeposit`.
    #[account(
        token::mint = token_mint,
        constraint = !fee_deposit.is_frozen() @ OFTError::FeeDepositFrozen,
        constraint = fee_deposit.owner != oft_store.key() @ OFTError::InvalidFeeDeposit,
    )]
    pub fee_deposit: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

impl InitConsoleOFT<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &InitConsoleOFTParams) -> Result<()> {
        ctx.accounts.oft_store.set_inner(OFTStore {
            oft_type: params.oft_type.clone(),
            ld2sd_rate: 10u64
                .checked_pow(u32::from(ctx.accounts.token_mint.decimals - params.shared_decimals))
                .ok_or(OFTError::InvalidDecimals)?,
            shared_decimals: params.shared_decimals,
            token_mint: ctx.accounts.token_mint.key(),
            initializer: ctx.accounts.initializer.key(),
            token_program: ctx.accounts.token_program.key(),
            bump: ctx.bumps.oft_store,
            transfer_hook_program: get_transfer_hook_program_id(&ctx.accounts.token_mint)?
                .unwrap_or_default(),
            // Token ACL may be configured later; sync_acl_gating_program fills this in.
            acl_gating_program: Pubkey::default(),
            fee_deposit: ctx.accounts.fee_deposit.key(),
            // Placeholders required to construct OFTStore before DefaultAdmin setup.
            // setup_default_admin! (below) writes the initial admin state while creating
            // the first RoleMember PDA.
            current_default_admin: Pubkey::default(),
            pending_default_admin: Pubkey::default(),
            default_paused: false,
            default_fee_bps: 0,
            use_global_state: false,
            is_globally_disabled: false,
            credit_redirect_config: None,
            token_manager: None,
            pubkey_policy: None,
        });
        emit_cpi!(FeeDepositSet {
            oft_store: ctx.accounts.oft_store.key(),
            fee_deposit: ctx.accounts.fee_deposit.key(),
        });
        let default_rate_limit = RateLimit::default();
        ctx.accounts.default_rate_limit.set_inner(default_rate_limit.clone());
        emit_cpi!(RateLimitConfigUpdated {
            oft_store: ctx.accounts.oft_store.key(),
            id: DEFAULT_RATE_LIMIT_ID,
            config: default_rate_limit.config,
        });
        rbac::setup_default_admin!(ctx, oft_store, params.admin, RoleType, payer);

        // Register the oapp
        endpoint_cpi::register_oapp(
            ENDPOINT_ID,
            ctx.accounts.oft_store.key(),
            ctx.remaining_accounts,
            &ctx.accounts.oft_store.signer_seeds(),
            RegisterOAppParams { delegate: params.admin },
        )
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitConsoleOFTParams {
    pub oft_type: OftType,
    pub admin: Pubkey,
    pub shared_decimals: u8,
}
