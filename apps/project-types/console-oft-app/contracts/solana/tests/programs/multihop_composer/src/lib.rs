//! # ⚠️ NOT AUDITED — TEST FIXTURE ONLY — DO NOT DEPLOY ⚠️
//!
//! This program has not been audited and must never be used in production or deployed to any
//! public cluster. It exists solely to answer a measurement question inside this repository's
//! test suite. It deliberately omits everything a real composer needs: no reentrancy guard, no
//! refund or failure bookkeeping, no validation that the payload's amount matches the balance
//! actually received, no authorization beyond checking that its OFT queued the message
//! (`params.from`), and no slippage protection on the
//! onward send. Treat it as a measuring instrument, not as reference code to copy.
//!
//! It is also **known not to execute on mainnet**: the compose-then-send call graph reaches
//! CPI stack height 6, and mainnet's limit is 5. It runs here only because the test lowers
//! or raises the depth deliberately. See SIMD-0268 (`raise_cpi_nesting_limit_to_8`).
//!
//! # Multihop Composer
//!
//! The Solana analogue of `MultiHopComposer.sol`: the OFT credits this program's associated token
//! account, then `lz_compose` spends the whole balance on a *new* `console_oft::send` toward a
//! third chain, with the `SendParams` carried in the compose payload.
//!
//! It exists to answer one question — does compose-then-send fit inside Transaction V1's hard
//! 64-address ceiling? A second hop drags the OFT's entire send account set into the compose
//! transaction: the fixed `Send` struct, both transfer-hook groups, the Endpoint's ten, and the
//! send library's executor/DVN/price-feed tail. `lz_compose_types_v3` plans all of it, so the
//! count is measurable from the plan alone.
//!
//! **Research fixture, not a template.** No reentrancy guard, no refund path, no failure
//! bookkeeping, and no validation that the payload's `SendParams` are sane. A real multihop
//! composer needs every one of those; see `MultiHopComposer.sol` for what is missing.
//!
//! The send library's own accounts (executor, DVNs, price feeds, treasury) are configured into
//! [`ComposerStore::send_library_tail`] at init rather than derived. A planner cannot discover
//! them: they live behind the ULN's send-config account, keyed by a message library whose owning
//! program is not derivable from any seed. The off-chain SDK reads three accounts to assemble the
//! same list (`packages/protocol/lz-v2-protocol-solana/src/send-helper.ts:467`).

pub mod instructions;

use anchor_lang::prelude::*;
use instructions::*;
use oapp::{composer, lz_compose_types_v3::LzComposeTypesV3Accounts, types::LzComposeParams};

declare_id!("Hop11111111111111111111111111111111111111111");

pub const COMPOSER_SEED: &[u8] = b"MultihopComposer";

/// One entry of the configured send-library tail.
///
/// `is_signer` means the Executor's payer fills the slot — the ULN charges its native fee to a
/// signer, and in a compose transaction the only signer available is the Executor.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct PlannedAccount {
    pub pubkey: Pubkey,
    pub is_writable: bool,
    pub is_signer: bool,
}

#[account]
#[derive(InitSpace)]
pub struct ComposerStore {
    /// The mint this composer re-sends. Bound at init so `lz_compose` cannot be pointed at
    /// another token.
    pub token_mint: Pubkey,
    /// The OFT whose `send` carries the second hop.
    pub oft_store: Pubkey,
    /// The OFT's fee sink. Configured because `lz_compose_types_info` cannot read the OFT store
    /// to find it, and the planner needs the live account to resolve the fee transfer's hook.
    pub fee_deposit: Pubkey,
    /// TokenManager root backing the OFT's permissioned-burn path, needed to plan `send`'s burn
    /// accounts.
    pub token_manager: Pubkey,
    /// Program owning the message library the OFT sends through, at Endpoint send index 2.
    pub send_library_program: Pubkey,
    /// Accounts the message library adds after the Endpoint's ten. See the module doc.
    #[max_len(32)]
    pub send_library_tail: Vec<PlannedAccount>,
    pub bump: u8,
}

impl ComposerStore {
    pub fn signer_seeds(&self) -> [&[u8]; 2] {
        [COMPOSER_SEED, std::slice::from_ref(&self.bump)]
    }
}

#[composer]
pub mod multihop_composer {
    pub fn init(mut ctx: Context<Init>, params: InitParams) -> Result<()> {
        Init::apply(&mut ctx, params)
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
    #[msg("Compose payload does not carry borsh-encoded SendParams")]
    MalformedSendParams,
    #[msg("Compose transaction is missing the planned send accounts")]
    MissingSendAccounts,
    #[msg("Compose message was not queued by the OFT this composer serves")]
    UntrustedSender,
}
