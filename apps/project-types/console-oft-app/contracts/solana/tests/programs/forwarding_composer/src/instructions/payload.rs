//! The composer's own payload contract, decoded from the OFT's compose message.
//!
//! The OFT wraps the source chain's `composeMsg` as
//! `[nonce:8][src_eid:4][amount_ld:8][compose_from:32][compose_msg]`. Everything from
//! `compose_msg` onward is opaque to the OFT — this composer defines it as a single 32-byte
//! final recipient.

use crate::ComposerError;
use anchor_lang::prelude::*;

const AMOUNT_LD_OFFSET: usize = 12;
const COMPOSE_MSG_OFFSET: usize = 52;
const RECIPIENT_LEN: usize = 32;

pub fn amount_ld(message: &[u8]) -> Result<u64> {
    let bytes: [u8; 8] = message
        .get(AMOUNT_LD_OFFSET..COMPOSE_MSG_OFFSET - 32)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(ComposerError::MissingAmount)?;
    Ok(u64::from_be_bytes(bytes))
}

pub fn final_recipient(message: &[u8]) -> Result<Pubkey> {
    let bytes: [u8; RECIPIENT_LEN] = message
        .get(COMPOSE_MSG_OFFSET..COMPOSE_MSG_OFFSET + RECIPIENT_LEN)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(ComposerError::MissingRecipient)?;
    Ok(Pubkey::new_from_array(bytes))
}
