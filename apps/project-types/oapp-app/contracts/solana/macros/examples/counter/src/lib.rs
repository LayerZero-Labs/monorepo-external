pub mod state;

use anchor_lang::prelude::*;
use oapp::{
    oapp_info::{IdlVersion, OAppBase, TlvSpace, OAPP_BASE_IDL_VERSION, OAPP_BASE_SCHEMA_VERSION},
    OAPP_INFO_SEED,
};
use state::{CounterInfoEntry, CounterRoleType, CounterState, COUNTER_SEED};

declare_id!("Cnt11111111111111111111111111111111111111111");

// ── Account structs ───────────────────────────────────────────────────────────

/// Initialize accounts.
///
/// `#[init_default_admin]` injects `admin_role_member` — a PDA that marks
/// the payer as the initial `DefaultAdmin` — so the role is established
/// atomically with state creation.
#[rbac::init_default_admin(state = state, role_type = CounterRoleType, payer = payer, admin = payer.key())]
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + CounterState::INIT_SPACE,
        seeds = [COUNTER_SEED],
        bump,
    )]
    pub state: Account<'info, CounterState>,

    /// CHECK: Raw SPL TLV account — no Anchor discriminator. Address verified
    /// by PDA seeds; ownership and allocation enforced by `init`.
    /// Program-level — a single `OAppInfo` PDA per program, written by
    /// `init_counter_oapp_info` as sibling `OAppBase` and `CounterInfoEntry`
    /// TLV entries.
    #[account(
        init,
        payer = payer,
        space = OAppBase::TLV_SPACE + CounterInfoEntry::TLV_SPACE,
        seeds = [OAPP_INFO_SEED],
        bump,
    )]
    pub oapp_info: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// UpdateOAppInfo accounts.
#[derive(Accounts)]
pub struct UpdateOAppInfo<'info> {
    pub authority: Signer<'info>,

    #[account(seeds = [COUNTER_SEED], bump = state.bump)]
    pub state: Account<'info, CounterState>,

    /// CHECK: Raw SPL TLV account — address validated by PDA seeds.
    #[account(
        mut,
        seeds = [OAPP_INFO_SEED],
        bump,
    )]
    pub oapp_info: UncheckedAccount<'info>,
}

/// LzReceive accounts: the counter, and the peer that must have sent the message. The Endpoint
/// `clear` accounts follow as remaining accounts, as `lz_receive_types_v3` plans them.
#[derive(Accounts)]
#[instruction(params: ::oapp::types::LzReceiveParams)]
pub struct LzReceive<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump = oapp.bump)]
    pub oapp: Account<'info, CounterState>,

    #[account(
        seeds = OAppPeer::seeds(&oapp.key(), params.src_eid),
        bump = peer.bump,
        constraint = peer.address == params.sender
    )]
    pub peer: Account<'info, OAppPeer>,
}

/// Account-discovery helpers (required by the LayerZero SDK).
#[derive(Accounts)]
pub struct LzReceiveTypesInfo<'info> {
    pub oapp: Account<'info, CounterState>,
    /// CHECK: discovery PDA placeholder — not validated in this example.
    pub lz_receive_types_accounts: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct LzReceiveTypesV3<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Ephemeral scratch the caller creates and signs for; `oapp::lz_plan` validates it.
    #[account(mut)]
    pub plan_out: Signer<'info>,
    pub oapp: Account<'info, CounterState>,
}

fn init_counter_oapp_info(info: &AccountInfo) -> Result<()> {
    oapp::init_oapp_base!(info, CounterInfoEntry);
    oapp::oapp_info::init_tlv_entry(info, &CounterInfoEntry::new())
}

// ── Program module ────────────────────────────────────────────────────────────
//
// Custom instructions:
//   initialize       — creates counter state; grants DefaultAdmin to payer
//   update_oapp_info — bumps OAppBase idl_version.minor in-place
//   lz_receive       — REQUIRED override; increments count on cross-chain message
//   lz_receive_types_info, lz_receive_types_v3
//                    — REQUIRED overrides; plan lz_receive's accounts for the Executor
//
// OApp-generated instructions (all use default accounts + handlers):
//   set_peer, get_peer
//   init_enforced_options, set_enforced_options, get_enforced_options
//   next_nonce, is_compose_msg_sender
//   clear, skip, burn, nilify (MessagingChannelRoles)
//
// RBAC-generated instructions (injected by #[oapp] → #[rbac]):
//   grant_role, revoke_role, renounce_role
//   begin_default_admin_transfer, accept_default_admin_transfer
//   get_default_admin

#[oapp::oapp(state = CounterState, role_type = CounterRoleType)]
pub mod counter {
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.state.count = 0;
        ctx.accounts.state.bump = ctx.bumps.state;
        rbac::setup_default_admin!(ctx, state, ctx.accounts.payer.key(), CounterRoleType, payer);

        let oapp_info = ctx.accounts.oapp_info.to_account_info();
        init_counter_oapp_info(&oapp_info)?;

        // Production must also call `endpoint_cpi::register_oapp(...)` here
        // so `accept_default_admin_transfer`'s `set_delegate` CPI finds the
        // `OAppRegistry` PDA. Omitted here for mollusk-svm (no endpoint
        // program loaded).
        Ok(())
    }

    /// Demonstrates in-place `OAppBase` update. Bumps `idl_version.minor` — packed length is
    /// preserved, which `update_tlv_entry` requires.
    pub fn update_oapp_info(ctx: Context<UpdateOAppInfo>) -> Result<()> {
        let oapp_info = ctx.accounts.oapp_info.to_account_info();
        let entry = OAppBase {
            schema_version: OAPP_BASE_SCHEMA_VERSION,
            idl_version: IdlVersion {
                major: OAPP_BASE_IDL_VERSION.major,
                minor: OAPP_BASE_IDL_VERSION.minor + 1,
            },
            app_discriminator: <[u8; 8]>::from(
                <CounterInfoEntry as ::spl_discriminator::SplDiscriminate>::SPL_DISCRIMINATOR,
            ),
        };
        oapp::oapp_info::update_tlv_entry(&oapp_info, &entry)?;
        Ok(())
    }

    /// Increments the counter for every inbound cross-chain message. Clearing the payload through
    /// the Endpoint is what proves the message was verified and consumes it; without it anyone
    /// could call this with made-up params.
    #[oapp_instruction]
    pub fn lz_receive(
        ctx: &mut Context<LzReceive>,
        params: &::oapp::types::LzReceiveParams,
    ) -> Result<()> {
        ctx.accounts.oapp.count = ctx.accounts.oapp.count.saturating_add(1);
        let oapp = ctx.accounts.oapp.key();
        ::oapp::endpoint_cpi::clear(
            ::oapp::endpoint::ID,
            oapp,
            ctx.remaining_accounts,
            &::oapp::OAppState::signer_seeds(&*ctx.accounts.oapp),
            ::oapp::endpoint::types::ClearParams {
                receiver: oapp,
                src_eid: params.src_eid,
                sender: params.sender,
                nonce: params.nonce,
                guid: params.guid,
                message: params.message.clone(),
            },
        )?;
        Ok(())
    }

    #[oapp_instruction]
    pub fn lz_receive_types_info(
        ctx: &Context<LzReceiveTypesInfo>,
        _params: &::oapp::types::LzReceiveParams,
    ) -> Result<(u8, ::oapp::lz_receive_types_v3::LzReceiveTypesV3Accounts)> {
        Ok((
            ::oapp::lz_receive_types_v3::LZ_RECEIVE_TYPES_VERSION,
            ::oapp::lz_receive_types_v3::LzReceiveTypesV3Accounts {
                accounts: vec![ctx.accounts.oapp.key()],
            },
        ))
    }

    #[oapp_instruction]
    pub fn lz_receive_types_v3(
        ctx: &mut Context<LzReceiveTypesV3>,
        params: &::oapp::types::LzReceiveParams,
    ) -> Result<u32> {
        let oapp = ctx.accounts.oapp.key();
        let (peer, _) =
            Pubkey::find_program_address(OAppPeer::seeds(&oapp, params.src_eid), ctx.program_id);
        let mut accounts = vec![
            ::oapp::common::AccountMetaRef { pubkey: oapp.into(), is_writable: true },
            ::oapp::common::AccountMetaRef { pubkey: peer.into(), is_writable: false },
        ];
        accounts.extend(::oapp::lz_receive_types_v3::get_accounts_for_clear(
            ::oapp::endpoint::ID,
            &oapp,
            params.src_eid,
            &params.sender,
            params.nonce,
        ));
        let plan = ::oapp::lz_receive_types_v3::LzReceiveTypesV3Result {
            context_version: ::oapp::common::EXECUTION_CONTEXT_VERSION_1,
            instructions: vec![::oapp::lz_receive_types_v3::Instruction::LzReceive { accounts }],
        };
        ::oapp::lz_plan::write(ctx.program_id, &ctx.accounts.plan_out, &plan)
    }
}
