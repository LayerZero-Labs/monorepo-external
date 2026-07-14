use soroban_sdk::{Bytes, BytesN, Env};
use utils::{buffer_reader::BufferReader, buffer_writer::BufferWriter};

/// Decoded compose message containing transfer context and payload execution
#[derive(Clone, Debug)]
pub struct OFTComposeMsg {
    /// Unique sequence number for the cross-chain message packet
    pub nonce: u64,
    /// Source endpoint ID where the transfer originated
    pub src_eid: u32,
    /// Amount received in local decimals
    pub amount_ld: i128,
    /// Address that initiated the compose call on the source chain
    pub compose_from: BytesN<32>,
    /// Custom payload for compose logic execution
    pub compose_msg: Bytes,
}

impl OFTComposeMsg {
    /// Encodes the OFTComposeMsg struct into Bytes.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Returns
    /// Encoded bytes representation of the compose message
    pub fn encode(&self, env: &Env) -> Bytes {
        let mut writer = BufferWriter::new(env);
        writer
            .write_u64(self.nonce)
            .write_u32(self.src_eid)
            .write_i128(self.amount_ld)
            .write_bytes_n(&self.compose_from)
            .write_bytes(&self.compose_msg)
            .to_bytes()
    }

    /// Decodes Bytes into an OFTComposeMsg struct.
    ///
    /// # Arguments
    /// * `bytes` - The encoded bytes to decode
    ///
    /// # Returns
    /// Decoded OFTComposeMsg struct
    pub fn decode(bytes: &Bytes) -> Self {
        let mut reader = BufferReader::new(bytes);
        let nonce = reader.read_u64();
        let src_eid = reader.read_u32();
        let amount_ld = reader.read_i128();
        let compose_from = reader.read_bytes_n::<32>();
        let compose_msg = reader.read_bytes_until_end();

        OFTComposeMsg { nonce, src_eid, amount_ld, compose_from, compose_msg }
    }
}
