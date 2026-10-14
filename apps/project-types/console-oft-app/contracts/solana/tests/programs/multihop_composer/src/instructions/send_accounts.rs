//! The `console_oft::send` account set, derived once and shared by the planner and the handler.
//!
//! `lz_compose_types_v3` emits these as `AccountMetaRef`s and `lz_compose` reads them back
//! positionally out of `remaining_accounts`, so both sides must agree on the order. Keeping the
//! order in one place is the only thing stopping the two from drifting.

use anchor_lang::prelude::*;
use console_oft::{
    msg_type,
    state::{
        FeeConfig, OFTStore, PauseConfig, RateLimit, RateLimitAddressExemption,
        DEFAULT_RATE_LIMIT_ID,
    },
    EnforcedOptions, OAppPeer,
};
use oapp::{
    common::AccountMetaRef, endpoint::ID as ENDPOINT_ID, ENDPOINT_SEED, EVENT_SEED,
    MESSAGE_LIB_SEED, NONCE_SEED, SEND_LIBRARY_CONFIG_SEED,
};

/// Anchor's convention for an absent optional account: the callee program's own id.
pub fn optional_placeholder() -> Pubkey {
    console_oft::ID
}

/// The `console_oft::Send` accounts the composer cannot supply from its own `Accounts` struct.
/// `signer`, `token_source`, `token_mint`, `token_program` and `program` are the composer's own,
/// and are named ahead of these in the planned account list.
pub struct SendFixedAccounts {
    pub oft_store: Pubkey,
    pub peer: Pubkey,
    pub enforced_options: Pubkey,
    pub pause_config: Pubkey,
    pub fee_config: Pubkey,
    pub default_rate_limit: Pubkey,
    pub rate_limit: Pubkey,
    pub address_exemption: Pubkey,
    pub oft_escrow: Pubkey,
    pub fee_deposit: Pubkey,
    pub burn_policy: Pubkey,
    pub burn_role: Pubkey,
    pub burn_manager: Pubkey,
    pub burn_signer: Pubkey,
    pub oft_event_authority: Pubkey,
}

pub const SEND_FIXED_LEN: usize = 15;

impl SendFixedAccounts {
    /// `source_authority` is the composer store PDA: it owns the token account `send` debits, so
    /// it is `send`'s signer and the subject of the rate-limit exemption.
    /// `permissioned_burn` reflects the mint's live PB extension — the OFT selects
    /// the burn path from mint state, not from which accounts the caller happened to pass.
    pub fn derive(
        oft_store_key: &Pubkey,
        oft_store: &OFTStore,
        dst_eid: u32,
        compose_msg: Option<&[u8]>,
        source_authority: &Pubkey,
        token_manager: &Pubkey,
        permissioned_burn: bool,
    ) -> Self {
        let pda =
            |seeds: &[&[u8]], program: &Pubkey| Pubkey::find_program_address(seeds, program).0;
        Self {
            oft_store: *oft_store_key,
            peer: pda(OAppPeer::seeds(oft_store_key, dst_eid), &console_oft::ID),
            enforced_options: pda(
                EnforcedOptions::seeds(oft_store_key, dst_eid, msg_type(compose_msg).into()),
                &console_oft::ID,
            ),
            pause_config: pda(PauseConfig::seeds(oft_store_key, dst_eid), &console_oft::ID),
            fee_config: pda(FeeConfig::seeds(oft_store_key, dst_eid), &console_oft::ID),
            default_rate_limit: pda(
                RateLimit::seeds(oft_store_key, DEFAULT_RATE_LIMIT_ID),
                &console_oft::ID,
            ),
            rate_limit: pda(RateLimit::seeds(oft_store_key, dst_eid), &console_oft::ID),
            address_exemption: pda(
                RateLimitAddressExemption::seeds(oft_store_key, source_authority),
                &console_oft::ID,
            ),
            oft_escrow: pda(OFTStore::oft_escrow_seeds(oft_store_key), &console_oft::ID),
            fee_deposit: oft_store.fee_deposit,
            burn_policy: if permissioned_burn { *token_manager } else { optional_placeholder() },
            burn_role: if permissioned_burn {
                Pubkey::find_program_address(
                    &[
                        rbac::ROLE_MEMBER_SEED,
                        token_manager.as_ref(),
                        &[token_manager::RoleType::Burner as u8],
                        pda(OFTStore::oft_escrow_seeds(oft_store_key), &console_oft::ID).as_ref(),
                    ],
                    &token_manager::ID,
                )
                .0
            } else {
                optional_placeholder()
            },
            burn_manager: if permissioned_burn {
                token_manager::ID
            } else {
                optional_placeholder()
            },
            burn_signer: if permissioned_burn {
                Pubkey::find_program_address(
                    &[
                        token_manager::SIGNER_SEED,
                        token_manager.as_ref(),
                        &[token_manager::SignerKind::PermissionedBurn as u8],
                    ],
                    &token_manager::ID,
                )
                .0
            } else {
                optional_placeholder()
            },
            oft_event_authority: pda(&[EVENT_SEED], &console_oft::ID),
        }
    }

    /// Writability mirrors `Send`'s account constraints
    /// (`programs/console_oft/src/instructions/send.rs:35`).
    pub fn metas(&self) -> [AccountMetaRef; SEND_FIXED_LEN] {
        let meta = |pubkey: Pubkey, is_writable: bool| AccountMetaRef {
            pubkey: pubkey.into(),
            is_writable,
        };
        [
            meta(self.oft_store, false),
            meta(self.peer, false),
            meta(self.enforced_options, false),
            meta(self.pause_config, false),
            meta(self.fee_config, false),
            meta(self.default_rate_limit, true),
            meta(self.rate_limit, true),
            meta(self.address_exemption, false),
            meta(self.oft_escrow, true),
            meta(self.fee_deposit, true),
            meta(self.burn_policy, false),
            meta(self.burn_role, false),
            meta(self.burn_manager, false),
            meta(self.burn_signer, false),
            meta(self.oft_event_authority, false),
        ]
    }
}

/// The Endpoint's own `send` accounts, in the order `oapp::endpoint_cpi::send` indexes them
/// (`dependencies/oapp-solana-contracts/src/endpoint_cpi.rs:160-170`). The send library's tail
/// follows these and is configured, not derived — see the crate doc.
pub fn endpoint_send_metas(
    oft_store: &Pubkey,
    dst_eid: u32,
    receiver: &[u8; 32],
    send_library_program: &Pubkey,
    message_lib: &Pubkey,
) -> Vec<AccountMetaRef> {
    let eid = dst_eid.to_be_bytes();
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &ENDPOINT_ID).0;
    let meta =
        |pubkey: Pubkey, is_writable: bool| AccountMetaRef { pubkey: pubkey.into(), is_writable };
    vec![
        meta(ENDPOINT_ID, false),
        meta(*oft_store, false),
        meta(*send_library_program, false),
        meta(pda(&[SEND_LIBRARY_CONFIG_SEED, oft_store.as_ref(), &eid]), false),
        meta(pda(&[SEND_LIBRARY_CONFIG_SEED, &eid]), false),
        meta(pda(&[MESSAGE_LIB_SEED, message_lib.as_ref()]), false),
        meta(pda(&[ENDPOINT_SEED]), false),
        meta(pda(&[NONCE_SEED, oft_store.as_ref(), &eid, receiver]), true),
        meta(pda(&[EVENT_SEED]), false),
        meta(ENDPOINT_ID, false),
    ]
}
