//! DVN constants

/// The raw bytes of the signature are 65 bytes long, the first 64 bytes are the signature, and the
/// last byte is the recovery ID.
pub const SIGNATURE_RAW_BYTES: usize = 65;

/// These values are copied from the EVM implementation assuming the receiver blockchain is
/// EVM-based.
pub const EXECUTE_FIXED_BYTES: u32 = 260;
pub const VERIFY_BYTES: u32 = 288;
