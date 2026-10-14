use crate::OFTError;
use anchor_lang::prelude::{require, Pubkey, Result};

// EVM alignment: OFTMsgCodec
// OFT send message = [send_to(32)][amount_sd(8)]([sender(32)][compose_msg])
// The [sender][compose_msg] tail is present only for SEND_AND_CALL messages.
const SEND_TO_OFFSET: usize = 0;
const SEND_AMOUNT_SD_OFFSET: usize = 32;
const SENDER_OFFSET: usize = 40;
const COMPOSE_MSG_OFFSET: usize = 72;

pub fn encode(
    send_to: [u8; 32],
    amount_sd: u64,
    sender: Pubkey,
    compose_msg: Option<&[u8]>,
) -> Vec<u8> {
    if let Some(msg) = compose_msg {
        let mut encoded = Vec::with_capacity(COMPOSE_MSG_OFFSET + msg.len()); // 32 + 8 + 32
        encoded.extend_from_slice(&send_to);
        encoded.extend_from_slice(&amount_sd.to_be_bytes());
        encoded.extend_from_slice(sender.to_bytes().as_ref());
        encoded.extend_from_slice(msg);
        encoded
    } else {
        let mut encoded = Vec::with_capacity(40); // 32 + 8
        encoded.extend_from_slice(&send_to);
        encoded.extend_from_slice(&amount_sd.to_be_bytes());
        encoded
    }
}

pub fn send_to(message: &[u8]) -> Result<[u8; 32]> {
    validate_message(message)?;
    let mut send_to = [0; 32];
    send_to.copy_from_slice(&message[SEND_TO_OFFSET..SEND_AMOUNT_SD_OFFSET]);
    Ok(send_to)
}

pub fn amount_sd(message: &[u8]) -> Result<u64> {
    validate_message(message)?;
    let mut amount_sd_bytes = [0; 8];
    amount_sd_bytes.copy_from_slice(&message[SEND_AMOUNT_SD_OFFSET..SENDER_OFFSET]);
    Ok(u64::from_be_bytes(amount_sd_bytes))
}

/// Compose tail `[sender][compose_msg]` (EVM `OFTMsgCodec.composeMsg`), or `None`
/// for a plain SEND message. The `_with_sender` suffix makes the sender prefix
/// explicit; EVM returns the same bytes under the bare `composeMsg` name.
pub fn compose_msg_with_sender(message: &[u8]) -> Result<Option<&[u8]>> {
    validate_message(message)?;
    if message.len() > SENDER_OFFSET {
        Ok(Some(&message[SENDER_OFFSET..]))
    } else {
        Ok(None)
    }
}

fn validate_message(message: &[u8]) -> Result<()> {
    require!(message.len() >= SENDER_OFFSET, OFTError::InvalidMessage);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEND_TO: [u8; 32] = [0x11; 32];

    /// EVM `OFTMsgCodec`: `[send_to][amount_sd BE]` for SEND, plus `[sender][compose_msg]` for
    /// SEND_AND_CALL. The decoders read the same offsets back.
    #[test]
    fn message_layout_matches_the_evm_oft_codec() {
        let sender = Pubkey::new_from_array([0xAB; 32]);
        let amount = 0x0102_0304_0506_0708;

        let send = encode(SEND_TO, amount, sender, None);
        assert_eq!(send, [&SEND_TO[..], &amount.to_be_bytes()].concat());

        let call = encode(SEND_TO, amount, sender, Some(&[0xDE, 0xAD]));
        assert_eq!(
            call,
            [&SEND_TO[..], &amount.to_be_bytes(), sender.as_ref(), &[0xDE, 0xAD]].concat()
        );
        assert_eq!(send_to(&call).unwrap(), SEND_TO);
        assert_eq!(amount_sd(&call).unwrap(), amount);
        // The tail keeps the sender prefix; splitting it off is the composer's job.
        assert_eq!(compose_msg_with_sender(&call).unwrap(), Some(&call[SENDER_OFFSET..]));
    }

    /// Receive routes a message to compose whenever any byte follows the 40-byte header.
    #[test]
    fn compose_tail_is_present_only_past_the_header() {
        let header = encode(SEND_TO, 0, Pubkey::default(), None);
        assert_eq!(compose_msg_with_sender(&header).unwrap(), None);
        let longer = [header.as_slice(), &[0x99]].concat();
        assert_eq!(compose_msg_with_sender(&longer).unwrap(), Some(&[0x99][..]));
    }

    #[test]
    fn decoders_reject_a_message_shorter_than_the_header() {
        let short = [0u8; SENDER_OFFSET - 1];
        assert!(send_to(&short).is_err());
        assert!(amount_sd(&short).is_err());
        assert!(compose_msg_with_sender(&short).is_err());
    }
}
