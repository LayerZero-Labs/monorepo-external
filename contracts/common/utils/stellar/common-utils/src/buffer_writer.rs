use crate::{errors::BufferWriterError, option_ext::OptionExt};
use soroban_sdk::{address_payload::AddressPayload, Address, Bytes, BytesN, Env, I256, U256};

/// Generates write methods for primitive integer types using big-endian byte order.
///
/// Each generated method writes a fixed number of bytes to the buffer, converts the
/// integer value to big-endian format, and advances the write position.
///
/// # Syntax
/// ```ignore
/// impl_write_int!(method_name, Type; ...);
/// ```
macro_rules! impl_write_int {
    ($($method:ident, $type:ty);* $(;)?) => {
        $(
            pub fn $method(&mut self, value: $type) -> &mut Self {
                self.buffer.extend_from_slice(&value.to_be_bytes());
                self
            }
        )*
    };
}

pub const ACCOUNT_PAYLOAD_TYPE: u8 = 0;
pub const CONTRACT_PAYLOAD_TYPE: u8 = 1;

/// A writer for serializing data to a byte buffer.
///
/// The writer maintains an internal byte buffer and provides methods to write
/// various data types in big-endian format. All write operations return a
/// mutable reference to the writer, enabling method chaining.
///
/// # Example
/// ```ignore
/// let mut writer = BufferWriter::new(&env);
/// writer.write_u32(0x12345678)
///       .write_bool(true)
///       .write_bytes32(&bytes32);
/// let bytes = writer.to_bytes();
/// ```
pub struct BufferWriter {
    buffer: Bytes,
}

impl BufferWriter {
    /// Create a new empty writer.
    pub fn new(env: &Env) -> Self {
        Self { buffer: Bytes::new(env) }
    }

    /// Create a new writer initialized with existing data.
    pub fn from_bytes(buffer: Bytes) -> Self {
        Self { buffer }
    }

    // Generates: write_u8 (1 byte), write_u16 (2 bytes), write_u32 (4 bytes), write_u64 (8 bytes), write_u128 (16 bytes)
    impl_write_int!(write_u8, u8; write_u16, u16; write_u32, u32; write_u64, u64; write_u128, u128);
    // Generate: write_i8 (1 byte), write_i16 (2 bytes), write_i32 (4 bytes), write_i64 (8 bytes), write_i128 (16 bytes)
    impl_write_int!(write_i8, i8; write_i16, i16; write_i32, i32; write_i64, i64; write_i128, i128);

    /// Write a boolean value to the buffer (true as 1, false as 0).
    pub fn write_bool(&mut self, value: bool) -> &mut Self {
        self.write_u8(if value { 1 } else { 0 })
    }

    /// Write an unsigned 256-bit integer in big-endian format.
    pub fn write_u256(&mut self, value: U256) -> &mut Self {
        self.buffer.append(&value.to_be_bytes());
        self
    }

    /// Write a signed 256-bit integer in big-endian format.
    pub fn write_i256(&mut self, value: I256) -> &mut Self {
        self.buffer.append(&value.to_be_bytes());
        self
    }

    /// Write an address type and payload to the buffer (33 bytes: 1 type + 32 payload).
    pub fn write_address(&mut self, address: &Address) -> &mut Self {
        let (payload_type, payload) = self.decompose_address(address);
        self.write_u8(payload_type).write_bytes_n(&payload)
    }

    /// Write an address payload only to the buffer (32 bytes).
    pub fn write_address_payload(&mut self, address: &Address) -> &mut Self {
        let (_, payload) = self.decompose_address(address);
        self.write_bytes_n(&payload)
    }

    /// Write a byte slice to the buffer (appends without length prefix).
    pub fn write_bytes(&mut self, bytes: &Bytes) -> &mut Self {
        self.buffer.append(bytes);
        self
    }

    /// Write a fixed-size BytesN<N> to the buffer.
    pub fn write_bytes_n<const N: usize>(&mut self, bytes_n: &BytesN<N>) -> &mut Self {
        self.buffer.extend_from_array(&bytes_n.to_array());
        self
    }

    pub fn write_array<const N: usize>(&mut self, array: &[u8; N]) -> &mut Self {
        self.buffer.extend_from_array(array);
        self
    }

    /// Get the complete buffer as a Bytes.
    pub fn to_bytes(&self) -> Bytes {
        self.buffer.clone()
    }

    /// Get the current length of the buffer.
    pub fn len(&self) -> u32 {
        self.buffer.len()
    }

    /// Check if the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Get the environment from the buffer.
    pub fn env(&self) -> &Env {
        self.buffer.env()
    }

    // ============================================================================================
    // Internal Functions
    // ============================================================================================

    /// Decompose an address into its type byte and 32-byte payload.
    fn decompose_address(&self, address: &Address) -> (u8, BytesN<32>) {
        match address.to_payload().unwrap_or_panic(self.buffer.env(), BufferWriterError::InvalidAddressPayload) {
            AddressPayload::AccountIdPublicKeyEd25519(p) => (ACCOUNT_PAYLOAD_TYPE, p),
            AddressPayload::ContractIdHash(p) => (CONTRACT_PAYLOAD_TYPE, p),
        }
    }
}
