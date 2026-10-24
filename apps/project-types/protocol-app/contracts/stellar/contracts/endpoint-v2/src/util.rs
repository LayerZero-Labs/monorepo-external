use soroban_sdk::{Address, Bytes, BytesN, Env};
use utils::buffer_writer::BufferWriter;

/// Computes a globally unique identifier (GUID) for cross-chain messages.
///
/// # Arguments
/// * `nonce` - The nonce of the message
/// * `src_eid` - The source endpoint ID
/// * `sender` - The sender OApp address on the source chain
/// * `dst_eid` - The destination endpoint ID
/// * `receiver` - The receiver OApp address on the destination chain
///
/// # Returns
/// * `BytesN<32>` - The GUID
pub fn compute_guid(
    env: &Env,
    nonce: u64,
    src_eid: u32,
    sender: &Address,
    dst_eid: u32,
    receiver: &BytesN<32>,
) -> BytesN<32> {
    let mut writer = BufferWriter::new(env);
    let payload = writer
        .write_u64(nonce)
        .write_u32(src_eid)
        .write_address_payload(sender)
        .write_u32(dst_eid)
        .write_bytes_n(receiver)
        .to_bytes();
    keccak256(env, &payload)
}

/// Builds a payload from a GUID and message.
///
/// # Arguments
/// * `env` - The environment
/// * `guid` - The GUID
/// * `message` - The message
///
/// # Returns
/// * `Bytes` - The payload
pub fn build_payload(env: &Env, guid: &BytesN<32>, message: &Bytes) -> Bytes {
    let mut data = Bytes::from_array(env, &guid.to_array());
    data.append(message);
    data
}

/// Computes the Keccak-256 hash of a message.
///
/// # Arguments
/// * `message` - The message
///
/// # Returns
/// * `BytesN<32>` - The hash
pub fn keccak256(env: &Env, message: &Bytes) -> BytesN<32> {
    env.crypto().keccak256(message).into()
}
