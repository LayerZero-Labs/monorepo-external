//! Compose plan format (planner version 3) and the Endpoint `clear_compose` account helper.
//!
//! See `docs/lz-compose-types.md` for how compose planning differs from receive planning.
use crate::{common::AccountMetaRef, COMPOSED_MESSAGE_HASH_SEED, EVENT_SEED};
use anchor_lang::prelude::*;
use solana_keccak_hasher::hash;

/// Planner version returned by `lz_compose_types_info`.
pub const LZ_COMPOSE_TYPES_VERSION: u8 = 3;

/// Returned by `lz_compose_types_info`: the planner's read-only, app-specific inputs.
///
/// The client prepends the payer and the plan scratch account. Account order is part of the
/// planner ABI, including Anchor's optional-account sentinels.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LzComposeTypesV3Accounts {
    pub accounts: Vec<Pubkey>,
}

/// Compose plan written by `lz_compose_types_v3`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LzComposeTypesV3Result {
    /// Execution-context version; selects the account
    /// [`AddressLocator::Context`](crate::common::AddressLocator::Context) resolves to.
    pub context_version: u8,
    /// Executed in order in one transaction. Must contain exactly one `LzCompose`; `Standard`
    /// instructions may precede or follow it.
    pub instructions: Vec<ComposeInstruction>,
}

/// One instruction of a compose plan.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum ComposeInstruction {
    /// The delivery: this program's `lz_compose`, called with the original params.
    LzCompose { accounts: Vec<AccountMetaRef> },
    /// Any other instruction, submitted as given.
    Standard { program_id: Pubkey, accounts: Vec<AccountMetaRef>, data: Vec<u8> },
}

/// Accounts for the Endpoint `clear_compose` CPI, in the order
/// [`crate::endpoint_cpi::clear_compose`] expects.
pub fn get_accounts_for_clear_compose(
    endpoint_program: Pubkey,
    from: &Pubkey,
    to: &Pubkey,
    guid: &[u8; 32],
    index: u16,
    composed_message: &[u8],
) -> Vec<AccountMetaRef> {
    let (composed_message_account, _) = Pubkey::find_program_address(
        &[
            COMPOSED_MESSAGE_HASH_SEED,
            &from.to_bytes(),
            &to.to_bytes(),
            &guid[..],
            &index.to_be_bytes(),
            &hash(composed_message).to_bytes(),
        ],
        &endpoint_program,
    );

    let (event_authority_account, _) =
        Pubkey::find_program_address(&[EVENT_SEED], &endpoint_program);

    vec![
        AccountMetaRef { pubkey: endpoint_program.into(), is_writable: false },
        AccountMetaRef { pubkey: (*to).into(), is_writable: false },
        AccountMetaRef { pubkey: composed_message_account.into(), is_writable: true },
        AccountMetaRef { pubkey: event_authority_account.into(), is_writable: false },
        AccountMetaRef { pubkey: endpoint_program.into(), is_writable: false },
    ]
}
