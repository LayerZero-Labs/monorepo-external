//! The composer's own payload contract, decoded from the OFT's compose message.
//!
//! The OFT wraps the source chain's `composeMsg` as
//! `[nonce:8][src_eid:4][amount_ld:8][compose_from:32][compose_msg]`. Everything from
//! `compose_msg` onward is opaque to the OFT — this composer defines it as borsh-encoded
//! [`SendParams`] for the second hop, matching `MultiHopComposer.sol`'s `abi.decode(_, SendParam)`.

use crate::ComposerError;
use anchor_lang::prelude::*;
use oft::types::SendParams;

const AMOUNT_LD_OFFSET: usize = 12;
const COMPOSE_FROM_OFFSET: usize = 20;
const COMPOSE_MSG_OFFSET: usize = 52;

/// Amount the OFT credited to this composer, and therefore the most the second hop can spend.
pub fn amount_ld(message: &[u8]) -> Result<u64> {
    let bytes: [u8; 8] = message
        .get(AMOUNT_LD_OFFSET..COMPOSE_FROM_OFFSET)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(ComposerError::MalformedSendParams)?;
    Ok(u64::from_be_bytes(bytes))
}

/// The second hop, as the source chain specified it. `amount_ld` is overwritten by the credited
/// amount at execution time, so a stale quote cannot make the composer overspend.
pub fn send_params(message: &[u8]) -> Result<SendParams> {
    let mut tail = message.get(COMPOSE_MSG_OFFSET..).ok_or(ComposerError::MalformedSendParams)?;
    let mut params = SendParams::deserialize(&mut tail)
        .map_err(|_| error!(ComposerError::MalformedSendParams))?;
    params.amount_ld = amount_ld(message)?;
    Ok(params)
}
