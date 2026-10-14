use anchor_lang::prelude::*;

#[cfg(all(feature = "custom-heap", not(feature = "no-entrypoint"), target_os = "solana"))]
heap_allocator::declare_allocator!();

pub mod codec;
pub mod console_oft_info;
pub mod errors;
pub mod events;
mod helpers;
pub mod instructions;
pub mod seeds;
pub mod state;

use errors::*;
// Public for composers and planners that must plan the same hook, burn and compose accounts;
// the rest of `helpers` is crate-internal.
pub(crate) use helpers::*;
pub use helpers::{
    append_transfer_hook_accounts, get_transfer_hook_program_id, msg_type,
    permissioned_burn_active, token_account_seed_prefix, MintTransferHook, MsgType,
    TransferHookAccounts, TransferHookDestination,
};
use instructions::*;
use oapp::{
    endpoint::types::{MessagingFee, MessagingReceipt},
    lz_receive_types_v3::LzReceiveTypesV3Accounts,
    types::LzReceiveParams,
};
use oft::types::{
    OFTReceipt, OftType, QuoteOFTParams, QuoteOFTResult, QuoteSendParams, SendParams,
};
use program_id::declare_program_id;
use state::*;

declare_program_id!("OFT_ID", "9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT");

#[oft::oft(state = OFTStore, role_type = RoleType)]
pub mod console_oft {

    pub fn init_console_oft_info(mut ctx: Context<InitConsoleOftInfo>) -> Result<()> {
        InitConsoleOftInfo::apply(&mut ctx)
    }

    pub fn init_console_oft(
        mut ctx: Context<InitConsoleOFT>,
        params: InitConsoleOFTParams,
    ) -> Result<()> {
        InitConsoleOFT::apply(&mut ctx, &params)
    }

    // ============================== OFT instructions ==============================

    #[oft_instruction]
    pub fn quote_oft(ctx: &Context<QuoteOFT>, params: &QuoteOFTParams) -> Result<QuoteOFTResult> {
        QuoteOFT::apply(ctx, params)
    }

    #[oft_instruction]
    pub fn quote_send(ctx: &Context<QuoteSend>, params: &QuoteSendParams) -> Result<MessagingFee> {
        QuoteSend::apply(ctx, params)
    }

    #[oft_instruction]
    pub fn send<'info>(
        ctx: &mut Context<'info, Send<'info>>,
        params: &SendParams,
    ) -> Result<(MessagingReceipt, OFTReceipt)> {
        Send::apply(ctx, params)
    }

    #[oft_instruction]
    pub fn oft_type(ctx: &Context<OftStoreView>) -> Result<OftType> {
        OftStoreView::oft_type(ctx)
    }

    #[oft_instruction]
    pub fn token(ctx: &Context<OftStoreView>) -> Result<Pubkey> {
        OftStoreView::token(ctx)
    }

    #[oft_instruction]
    pub fn shared_decimals(ctx: &Context<OftStoreView>) -> Result<u8> {
        OftStoreView::shared_decimals(ctx)
    }

    // ============================== Fee config instructions ==============================

    pub fn get_fee(ctx: Context<FeeConfigView>, params: GetFeeParams) -> Result<u64> {
        FeeConfigView::get_fee(&ctx, &params)
    }

    pub fn get_amount_before_fee(
        ctx: Context<FeeConfigView>,
        params: GetAmountBeforeFeeParams,
    ) -> Result<u64> {
        FeeConfigView::get_amount_before_fee(&ctx, &params)
    }

    pub fn default_fee_bps(ctx: Context<OftStoreView>) -> Result<u16> {
        OftStoreView::default_fee_bps(&ctx)
    }

    pub fn fee_bps(ctx: Context<FeeConfigView>, eid: u128) -> Result<Option<u16>> {
        FeeConfigView::fee_bps(&ctx, &eid)
    }

    pub fn set_default_fee_bps(mut ctx: Context<SetDefaultFeeBps>, fee_bps: u16) -> Result<()> {
        SetDefaultFeeBps::apply(&mut ctx, &fee_bps)
    }

    pub fn set_fee_bps(mut ctx: Context<SetFeeBps>, params: SetFeeBpsParams) -> Result<()> {
        SetFeeBps::apply(&mut ctx, &params)
    }

    // ============================== Fee handler instructions ==============================

    pub fn fee_deposit(ctx: Context<OftStoreView>) -> Result<Pubkey> {
        OftStoreView::fee_deposit(&ctx)
    }

    pub fn set_fee_deposit(mut ctx: Context<SetFeeDeposit>, fee_deposit: Pubkey) -> Result<()> {
        SetFeeDeposit::apply(&mut ctx, &fee_deposit)
    }

    // ============================== Pause instructions ==============================

    pub fn set_default_paused(mut ctx: Context<SetDefaultPaused>, paused: bool) -> Result<()> {
        SetDefaultPaused::apply(&mut ctx, &paused)
    }

    pub fn is_paused(ctx: Context<PauseConfigView>, id: u128) -> Result<bool> {
        PauseConfigView::is_paused(&ctx, &id)
    }

    pub fn get_pause_config(ctx: Context<PauseConfigView>, id: u128) -> Result<Option<bool>> {
        PauseConfigView::pause_config(&ctx, &id)
    }

    pub fn default_paused(ctx: Context<OftStoreView>) -> Result<bool> {
        OftStoreView::default_paused(&ctx)
    }

    pub fn set_paused(mut ctx: Context<SetPaused>, params: SetPausedParams) -> Result<()> {
        SetPaused::apply(&mut ctx, &params)
    }

    // ============================== Rate limiter instructions ==============================

    pub fn get_rate_limit_global_config(
        ctx: Context<OftStoreView>,
    ) -> Result<RateLimitGlobalConfig> {
        OftStoreView::get_rate_limit_global_config(&ctx)
    }

    pub fn rate_limits(ctx: Context<RateLimits>, id: u128) -> Result<Option<RateLimit>> {
        RateLimits::rate_limits(&ctx, &id)
    }

    pub fn is_rate_limit_address_exempt(
        ctx: Context<IsRateLimitAddressExempt>,
        user: Pubkey,
    ) -> Result<bool> {
        IsRateLimitAddressExempt::apply(&ctx, &user)
    }

    pub fn get_rate_limit_usages(
        ctx: Context<GetRateLimitUsages>,
        id: u128,
    ) -> Result<RateLimitUsages> {
        GetRateLimitUsages::get_rate_limit_usages(&ctx, &id)
    }

    pub fn set_rate_limit_global_config(
        mut ctx: Context<SetRateLimitGlobalConfig>,
        params: SetRateLimitGlobalConfigParams,
    ) -> Result<()> {
        SetRateLimitGlobalConfig::apply(&mut ctx, &params)
    }

    pub fn set_rate_limit_config(
        mut ctx: Context<SetRateLimitConfig>,
        params: SetRateLimitConfigParams,
    ) -> Result<()> {
        SetRateLimitConfig::apply(&mut ctx, &params)
    }

    pub fn set_rate_limit_state(
        mut ctx: Context<SetRateLimitState>,
        params: SetRateLimitStateParams,
    ) -> Result<()> {
        SetRateLimitState::apply(&mut ctx, &params)
    }

    pub fn set_rate_limit_address_exemption(
        mut ctx: Context<SetRateLimitAddressExemption>,
        params: SetRateLimitAddressExemptionParams,
    ) -> Result<()> {
        SetRateLimitAddressExemption::apply(&mut ctx, &params)
    }

    pub fn checkpoint_rate_limit(mut ctx: Context<CheckpointRateLimit>, id: u128) -> Result<()> {
        CheckpointRateLimit::apply(&mut ctx, &id)
    }

    // ============================== lz_receive instructions ==============================

    #[oapp_instruction]
    pub fn lz_receive<'info>(
        ctx: &mut Context<'info, LzReceive<'info>>,
        params: &LzReceiveParams,
    ) -> Result<()> {
        LzReceive::apply(ctx, params)
    }

    #[oapp_instruction]
    pub fn lz_receive_types_info(
        ctx: &Context<LzReceiveTypesInfo>,
        params: &LzReceiveParams,
    ) -> Result<(u8, LzReceiveTypesV3Accounts)> {
        LzReceiveTypesInfo::apply(ctx, params)
    }

    #[oapp_instruction]
    pub fn lz_receive_types_v3(
        ctx: &mut Context<LzReceiveTypesV3>,
        params: &LzReceiveParams,
    ) -> Result<u32> {
        LzReceiveTypesV3::apply(ctx, params)
    }

    // ============================== Transfer hook ==============================

    pub fn get_transfer_hook_program(ctx: Context<OftStoreView>) -> Result<Pubkey> {
        OftStoreView::transfer_hook_program(&ctx)
    }

    /// Sync cached transfer_hook_program from mint extension. Permissionless.
    pub fn sync_transfer_hook_program(mut ctx: Context<SyncTransferHookProgram>) -> Result<()> {
        SyncTransferHookProgram::apply(&mut ctx)
    }

    /// Sync cached acl_gating_program from the mint's Token ACL config. Permissionless.
    pub fn sync_acl_gating_program(mut ctx: Context<SyncAclGatingProgram>) -> Result<()> {
        SyncAclGatingProgram::apply(&mut ctx)
    }

    // ============================== Credit admission and redirect ==============================

    pub fn set_pubkey_policy(mut ctx: Context<SetPubkeyPolicy>) -> Result<()> {
        SetPubkeyPolicy::apply(&mut ctx)
    }

    /// EVM alignment: `setCreditRedirectConfig`. Omitting `redirect_escrow` disables redirect.
    pub fn set_credit_redirect_config(mut ctx: Context<SetCreditRedirectConfig>) -> Result<()> {
        SetCreditRedirectConfig::apply(&mut ctx)
    }

    /// Select the TokenManager root BurnMint sends request PermissionedBurn approval from.
    pub fn set_token_manager(mut ctx: Context<SetTokenManager>) -> Result<()> {
        SetTokenManager::apply(&mut ctx)
    }
}
