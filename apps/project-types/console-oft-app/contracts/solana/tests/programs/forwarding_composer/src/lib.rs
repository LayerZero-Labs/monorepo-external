//! # ⚠️ NOT AUDITED — TEST FIXTURE ONLY — DO NOT DEPLOY ⚠️
//!
//! This program has not been audited and must never be used in production or deployed to any
//! public cluster. It exists solely to answer a measurement question inside this repository's
//! test suite. It deliberately omits everything a real composer needs: no reentrancy guard, no
//! refund or failure bookkeeping, no validation that the payload's amount matches the balance
//! actually received, no authorization on who may drive it, and no slippage protection on the
//! onward send. Treat it as a measuring instrument, not as reference code to copy.
//!
//! # Forwarding Composer
//!
//! A composer that *moves tokens*: the OFT credits this program's associated token account, then
//! `lz_compose` forwards the whole amount to a final recipient named in the compose payload.
//!
//! It exists to prove the half of the flow the OFT cannot own. An OFT hands over tokens and an
//! opaque payload and is done — it has no idea what a composer intends to do with them. So when
//! the mint is governed by canonical ACL, every newly created account is frozen by
//! `DefaultAccountState`, and the *composer's* `lz_compose` creates and activates its own
//! destination using the shared Rust helper, in its own transaction.
//!
//! **Integration-testing only.**

pub mod instructions;

use anchor_lang::prelude::*;
use instructions::*;
use oapp::{composer, lz_compose_types_v3::LzComposeTypesV3Accounts, types::LzComposeParams};

declare_id!("Fwd11111111111111111111111111111111111111111");

pub const COMPOSER_SEED: &[u8] = b"ForwardingComposer";

#[account]
#[derive(InitSpace)]
pub struct ComposerStore {
    /// The mint this composer forwards. Bound at init so `lz_compose` cannot be pointed at
    /// another token.
    pub token_mint: Pubkey,
    /// The pubkey policy the ACL gate binds for that mint, needed to plan create-and-thaw.
    pub pubkey_policy: Pubkey,
    /// The OFT store whose receives queue compose messages here: the only trusted sender. Anyone
    /// can queue a compose message, so `lz_compose` checks `params.from` against it.
    pub oft_store: Pubkey,
    /// Incremented on each successful forward.
    pub forwarded_count: u64,
    pub bump: u8,
}

impl ComposerStore {
    pub fn signer_seeds(&self) -> [&[u8]; 2] {
        [COMPOSER_SEED, std::slice::from_ref(&self.bump)]
    }
}

#[composer]
pub mod forwarding_composer {
    pub fn init(
        mut ctx: Context<Init>,
        token_mint: Pubkey,
        pubkey_policy: Pubkey,
        oft_store: Pubkey,
    ) -> Result<()> {
        Init::apply(&mut ctx, token_mint, pubkey_policy, oft_store)
    }

    #[composer_instruction]
    pub fn lz_compose_types_info(
        ctx: &Context<LzComposeTypesInfo>,
        params: &LzComposeParams,
    ) -> Result<(u8, LzComposeTypesV3Accounts)> {
        LzComposeTypesInfo::apply(ctx, params)
    }

    #[composer_instruction]
    pub fn lz_compose_types_v3<'info>(
        ctx: &mut Context<'info, LzComposeTypesV3<'info>>,
        params: &LzComposeParams,
    ) -> Result<u32> {
        LzComposeTypesV3::apply(ctx, params)
    }

    #[composer_instruction]
    pub fn lz_compose<'info>(
        ctx: &mut Context<'info, LzCompose<'info>>,
        params: &LzComposeParams,
    ) -> Result<()> {
        LzCompose::apply(ctx, params)
    }
}

#[error_code]
pub enum ComposerError {
    #[msg("Compose payload does not carry a 32-byte final recipient")]
    MissingRecipient,
    #[msg("Compose payload is too short to carry an amount")]
    MissingAmount,
    #[msg("Missing or invalid ACL activation inputs")]
    InvalidAclInputs,
    #[msg("Final recipient is blocked by the selected pubkey policy")]
    RecipientBlocked,
    #[msg("Compose message was not queued by the OFT this composer serves")]
    UntrustedSender,
}
