use soroban_sdk::{Bytes, BytesN, Env};
use utils::{buffer_reader::BufferReader, buffer_writer::BufferWriter};

/// Decoded OFT message containing transfer details and optional compose data.
///
/// Wire format:
/// ```text
/// [send_to: 32 bytes][amount_sd: 8 bytes][compose_from: 32 bytes (optional)][compose_msg: variable (optional)]
/// ```
#[derive(Clone, Debug)]
pub struct OFTMessage {
    /// Recipient address on the destination chain
    pub send_to: BytesN<32>,
    /// Amount to transfer in shared decimals
    pub amount_sd: u64,
    /// Optional compose data for cross-chain composed calls
    pub compose: Option<ComposeData>,
}

/// Initiator address and payload for a cross-chain composed call.
#[derive(Clone, Debug)]
pub struct ComposeData {
    /// Address that initiated the compose call
    pub from: BytesN<32>,
    /// Compose message payload
    pub msg: Bytes,
}

impl OFTMessage {
    /// Encodes the OFTMessage into Bytes.
    pub fn encode(&self, env: &Env) -> Bytes {
        let mut writer = BufferWriter::new(env);
        writer.write_bytes_n(&self.send_to).write_u64(self.amount_sd);

        if let Some(ref compose_data) = self.compose {
            writer.write_bytes_n(&compose_data.from).write_bytes(&compose_data.msg);
        }

        writer.to_bytes()
    }

    /// Decodes Bytes into an OFTMessage.
    pub fn decode(message: &Bytes) -> Self {
        let mut reader = BufferReader::new(message);
        let send_to = reader.read_bytes_n::<32>();
        let amount_sd = reader.read_u64();

        let compose = if reader.remaining_len() > 0 {
            let from = reader.read_bytes_n::<32>();
            let msg = reader.read_bytes_until_end();
            Some(ComposeData { from, msg })
        } else {
            None
        };

        OFTMessage { send_to, amount_sd, compose }
    }
}
