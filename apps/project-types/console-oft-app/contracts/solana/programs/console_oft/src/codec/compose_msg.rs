use crate::OFTError;
use anchor_lang::prelude::{require, Result};

// Solana compose messages keep the same field order as EVM's OFTComposeMsgCodec,
// but use a compact u64 amount_ld instead of EVM's uint256 amountLD.
// Layout: [nonce:8][src_eid:4][amount_ld:8][compose_from:32][compose_msg]
const NONCE_OFFSET: usize = 0;
const SRC_EID_OFFSET: usize = 8;
const AMOUNT_LD_OFFSET: usize = 12;
const COMPOSE_FROM_OFFSET: usize = 20;
const COMPOSE_MSG_OFFSET: usize = 52;

pub fn encode(
    nonce: u64,
    src_eid: u32,
    amount_ld: u64,
    compose_msg: &[u8], // [composeFrom][composeMsg]
) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(20 + compose_msg.len()); // 8 + 4 + 8
    encoded.extend_from_slice(&nonce.to_be_bytes());
    encoded.extend_from_slice(&src_eid.to_be_bytes());
    encoded.extend_from_slice(&amount_ld.to_be_bytes());
    encoded.extend_from_slice(compose_msg);
    encoded
}

pub fn nonce(message: &[u8]) -> Result<u64> {
    validate_compose_message(message)?;
    let mut nonce_bytes = [0; 8];
    nonce_bytes.copy_from_slice(&message[NONCE_OFFSET..SRC_EID_OFFSET]);
    Ok(u64::from_be_bytes(nonce_bytes))
}

pub fn src_eid(message: &[u8]) -> Result<u32> {
    validate_compose_message(message)?;
    let mut src_eid_bytes = [0; 4];
    src_eid_bytes.copy_from_slice(&message[SRC_EID_OFFSET..AMOUNT_LD_OFFSET]);
    Ok(u32::from_be_bytes(src_eid_bytes))
}

pub fn amount_ld(message: &[u8]) -> Result<u64> {
    validate_compose_message(message)?;
    let mut amount_ld_bytes = [0; 8];
    amount_ld_bytes.copy_from_slice(&message[AMOUNT_LD_OFFSET..COMPOSE_FROM_OFFSET]);
    Ok(u64::from_be_bytes(amount_ld_bytes))
}

pub fn compose_from(message: &[u8]) -> Result<[u8; 32]> {
    validate_compose_message(message)?;
    let mut compose_from = [0; 32];
    compose_from.copy_from_slice(&message[COMPOSE_FROM_OFFSET..COMPOSE_MSG_OFFSET]);
    Ok(compose_from)
}

pub fn compose_msg(message: &[u8]) -> Result<&[u8]> {
    validate_compose_message(message)?;
    Ok(&message[COMPOSE_MSG_OFFSET..])
}

fn validate_compose_message(message: &[u8]) -> Result<()> {
    require!(message.len() >= COMPOSE_MSG_OFFSET, OFTError::InvalidMessage);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// EVM `OFTComposeMsgCodec` field order with a u64 `amount_ld`:
    /// `[nonce BE][src_eid BE][amount_ld BE][compose_from][compose_msg]`.
    #[test]
    fn compose_message_layout_matches_the_evm_field_order() {
        let from = [0x10; 32];
        let tail = [&from[..], &[0xCA, 0xFE]].concat();
        let message = encode(0x0102_0304_0506_0708, 0x0A0B_0C0D, u64::MAX, &tail);
        assert_eq!(
            message,
            [
                &0x0102_0304_0506_0708u64.to_be_bytes()[..],
                &0x0A0B_0C0Du32.to_be_bytes(),
                &u64::MAX.to_be_bytes(),
                &tail,
            ]
            .concat()
        );
        assert_eq!(nonce(&message).unwrap(), 0x0102_0304_0506_0708);
        assert_eq!(src_eid(&message).unwrap(), 0x0A0B_0C0D);
        assert_eq!(amount_ld(&message).unwrap(), u64::MAX);
        assert_eq!(compose_from(&message).unwrap(), from);
        assert_eq!(compose_msg(&message).unwrap(), &[0xCA, 0xFE]);
        // A message with an empty payload is exactly the header.
        assert!(compose_msg(&encode(0, 0, 0, &from)).unwrap().is_empty());
    }

    #[test]
    fn decoders_reject_a_message_shorter_than_the_header() {
        let short = [0u8; COMPOSE_MSG_OFFSET - 1];
        assert!(nonce(&short).is_err());
        assert!(src_eid(&short).is_err());
        assert!(amount_ld(&short).is_err());
        assert!(compose_from(&short).is_err());
        assert!(compose_msg(&short).is_err());
    }
}
