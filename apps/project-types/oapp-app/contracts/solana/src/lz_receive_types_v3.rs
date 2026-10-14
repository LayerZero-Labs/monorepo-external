//! Receive plan format (planner version 3) and Endpoint account helpers for building plans.
//!
//! See `docs/lz-receive-types.md` for the planning protocol.
use crate::{
    COMPOSED_MESSAGE_HASH_SEED, ENDPOINT_SEED, EVENT_SEED, NONCE_SEED, OAPP_SEED, PAYLOAD_HASH_SEED,
};
use anchor_lang::{prelude::*, solana_program::system_program::ID as SYSTEM_ID};
use solana_keccak_hasher::hash;

/// Planner version returned by `lz_receive_types_info`.
pub const LZ_RECEIVE_TYPES_VERSION: u8 = 3;

/// Returned by `lz_receive_types_info`: the planner's read-only, app-specific inputs.
///
/// The client prepends the payer and the plan scratch account. Account order is part of the
/// planner ABI, including Anchor's optional-account sentinels.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LzReceiveTypesV3Accounts {
    pub accounts: Vec<Pubkey>,
}

use crate::common::{AccountMetaRef, AddressLocator};

/// Receive plan written by `lz_receive_types_v3`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LzReceiveTypesV3Result {
    /// Execution-context version; selects the account [`AddressLocator::Context`] resolves to.
    pub context_version: u8,
    /// Executed in order in one transaction. Must contain exactly one `LzReceive`; `Standard`
    /// instructions may precede or follow it.
    pub instructions: Vec<Instruction>,
}

/// One instruction of a receive plan.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum Instruction {
    /// The delivery: this program's `lz_receive`, called with the original params.
    LzReceive { accounts: Vec<AccountMetaRef> },
    /// Any other instruction, submitted as given.
    Standard { program_id: Pubkey, accounts: Vec<AccountMetaRef>, data: Vec<u8> },
}

/// Accounts for the Endpoint `clear` CPI, in the order [`crate::endpoint_cpi::clear`] expects.
pub fn get_accounts_for_clear(
    endpoint_program: Pubkey,
    receiver: &Pubkey,
    src_eid: u32,
    sender: &[u8; 32],
    nonce: u64,
) -> Vec<AccountMetaRef> {
    let (nonce_account, _) = Pubkey::find_program_address(
        &[NONCE_SEED, &receiver.to_bytes(), &src_eid.to_be_bytes(), sender],
        &endpoint_program,
    );

    let (payload_hash_account, _) = Pubkey::find_program_address(
        &[
            PAYLOAD_HASH_SEED,
            &receiver.to_bytes(),
            &src_eid.to_be_bytes(),
            sender,
            &nonce.to_be_bytes(),
        ],
        &endpoint_program,
    );

    let (oapp_registry_account, _) =
        Pubkey::find_program_address(&[OAPP_SEED, &receiver.to_bytes()], &endpoint_program);
    let (event_authority_account, _) =
        Pubkey::find_program_address(&[EVENT_SEED], &endpoint_program);
    let (endpoint_settings_account, _) =
        Pubkey::find_program_address(&[ENDPOINT_SEED], &endpoint_program);

    vec![
        AccountMetaRef { pubkey: endpoint_program.into(), is_writable: false },
        AccountMetaRef { pubkey: (*receiver).into(), is_writable: false },
        AccountMetaRef { pubkey: oapp_registry_account.into(), is_writable: false },
        AccountMetaRef { pubkey: nonce_account.into(), is_writable: false },
        AccountMetaRef { pubkey: payload_hash_account.into(), is_writable: true },
        AccountMetaRef { pubkey: endpoint_settings_account.into(), is_writable: true },
        AccountMetaRef { pubkey: event_authority_account.into(), is_writable: false },
        AccountMetaRef { pubkey: endpoint_program.into(), is_writable: false },
    ]
}

/// Accounts for the Endpoint `send_compose` CPI, in the order [`crate::endpoint_cpi::send_compose`]
/// expects. The Executor's payer funds the composed-message account.
pub fn get_accounts_for_send_compose(
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
        AccountMetaRef { pubkey: (*from).into(), is_writable: false },
        AccountMetaRef { pubkey: AddressLocator::Payer, is_writable: true },
        AccountMetaRef { pubkey: composed_message_account.into(), is_writable: true },
        AccountMetaRef { pubkey: SYSTEM_ID.into(), is_writable: false },
        AccountMetaRef { pubkey: event_authority_account.into(), is_writable: false },
        AccountMetaRef { pubkey: endpoint_program.into(), is_writable: false },
    ]
}
