use crate::{
    buffer_writer::{ACCOUNT_PAYLOAD_TYPE, CONTRACT_PAYLOAD_TYPE},
    bytes_ext::BytesExt,
    errors::BufferReaderError,
};
use core::mem;
use soroban_sdk::{
    address_payload::AddressPayload, assert_with_error, panic_with_error, Address, Bytes, BytesN, Env, I256, U256,
};

/// Generates read methods for primitive integer types using big-endian byte order.
///
/// Each generated method reads a fixed number of bytes from the buffer, converts them
/// from big-endian format to the target integer type, and advances the read position.
///
/// # Syntax
/// ```ignore
/// impl_read_int!(method_name, Type; ...);
/// ```
macro_rules! impl_read_int {
    ($($method:ident, $type:ty);* $(;)?) => {
        $(
            pub fn $method(&mut self) -> $type {
                <$type>::from_be_bytes(self.read_bytes(mem::size_of::<$type>() as u32).to_array())
            }
        )*
    };
}

/// A sequential reader for parsing binary data from a byte buffer.
///
/// Maintains a position cursor that advances as data is read.
/// All integer reads are big-endian.
///
/// # Example
/// ```ignore
/// let mut reader = BufferReader::new(&bytes);
/// let value = reader.read_u32();
/// let value = reader.read_bool();
/// let addr = reader.read_address();
/// ```
pub struct BufferReader<'a> {
    buffer: &'a Bytes,
    pos: u32,
}

impl<'a> BufferReader<'a> {
    /// Creates a new reader starting at position 0.
    pub fn new(buffer: &'a Bytes) -> Self {
        Self { buffer, pos: 0 }
    }

    /// Sets the read position to an absolute byte offset.
    pub fn seek(&mut self, pos: u32) -> &mut Self {
        assert_with_error!(self.buffer.env(), pos <= self.buffer.len(), BufferReaderError::InvalidLength);
        self.pos = pos;
        self
    }

    /// Advances the position by `len` bytes without reading.
    pub fn skip(&mut self, len: u32) -> &mut Self {
        self.seek(self.pos + len)
    }

    /// Moves the position backwards by `len` bytes.
    pub fn rewind(&mut self, len: u32) -> &mut Self {
        assert_with_error!(self.buffer.env(), self.pos >= len, BufferReaderError::InvalidLength);
        self.pos -= len;
        self
    }

    // Generates: read_u8 (1 byte), read_u16 (2 bytes), read_u32 (4 bytes), read_u64 (8 bytes), read_u128 (16 bytes)
    impl_read_int!(read_u8, u8; read_u16, u16; read_u32, u32; read_u64, u64; read_u128, u128);
    // Generate: read_i8 (1 byte), read_i16 (2 bytes), read_i32 (4 bytes), read_i64 (8 bytes), read_i128 (16 bytes)
    impl_read_int!(read_i8, i8; read_i16, i16; read_i32, i32; read_i64, i64; read_i128, i128);

    /// Reads a boolean (1 byte, non-zero = true).
    pub fn read_bool(&mut self) -> bool {
        self.read_u8() != 0
    }

    /// Reads a U256 (32 bytes, big-endian).
    pub fn read_u256(&mut self) -> U256 {
        U256::from_be_bytes(self.buffer.env(), &self.read_bytes(32))
    }

    /// Reads a I256 (32 bytes, big-endian).
    pub fn read_i256(&mut self) -> I256 {
        I256::from_be_bytes(self.buffer.env(), &self.read_bytes(32))
    }

    /// Reads a Stellar address (33 bytes: 1 type + 32 payload).
    pub fn read_address(&mut self) -> Address {
        let payload_type = self.read_u8();
        let payload = self.read_address_payload();
        self.compose_address(payload_type, payload)
    }

    /// Reads an address payload only from the buffer (32 bytes).
    pub fn read_address_payload(&mut self) -> BytesN<32> {
        self.read_bytes_n()
    }

    /// Reads N bytes as a fixed-size BytesN<N>.
    pub fn read_bytes_n<const N: usize>(&mut self) -> BytesN<N> {
        BytesN::<N>::from_array(self.buffer.env(), &self.read_array())
    }

    pub fn read_array<const N: usize>(&mut self) -> [u8; N] {
        self.read_bytes(N as u32).to_array()
    }

    /// Reads `len` bytes from current position and advances.
    pub fn read_bytes(&mut self, len: u32) -> Bytes {
        let end = self.pos + len;
        assert_with_error!(self.buffer.env(), self.buffer.len() >= end, BufferReaderError::InvalidLength);

        let value = self.buffer.slice(self.pos..end);
        self.pos = end;
        value
    }

    /// Reads all bytes from current position to the end of the buffer.
    pub fn read_bytes_until_end(&mut self) -> Bytes {
        self.read_bytes(self.remaining_len())
    }

    /// Returns the current read position.
    pub fn position(&self) -> u32 {
        self.pos
    }

    /// Returns a reference to the underlying buffer.
    pub fn buffer(&self) -> &Bytes {
        self.buffer
    }

    /// Returns the total length of the buffer.
    pub fn len(&self) -> u32 {
        self.buffer.len()
    }

    /// Returns true if the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Returns the number of bytes remaining after current position.
    pub fn remaining_len(&self) -> u32 {
        self.buffer.len() - self.pos
    }

    /// Returns the Soroban environment reference.
    pub fn env(&self) -> &Env {
        self.buffer.env()
    }

    // ============================================================================================
    // Internal Functions
    // ============================================================================================

    /// Compose an address from its type byte and 32-byte payload.
    fn compose_address(&self, payload_type: u8, payload: BytesN<32>) -> Address {
        let addr_payload = match payload_type {
            ACCOUNT_PAYLOAD_TYPE => AddressPayload::AccountIdPublicKeyEd25519(payload),
            CONTRACT_PAYLOAD_TYPE => AddressPayload::ContractIdHash(payload),
            _ => panic_with_error!(self.buffer.env(), BufferReaderError::InvalidAddressPayload),
        };
        Address::from_payload(self.buffer.env(), addr_payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_size_of_unsigned_integers() {
        assert_eq!(mem::size_of::<u8>(), 1);
        assert_eq!(mem::size_of::<u16>(), 2);
        assert_eq!(mem::size_of::<u32>(), 4);
        assert_eq!(mem::size_of::<u64>(), 8);
        assert_eq!(mem::size_of::<u128>(), 16);
    }

    #[test]
    fn test_size_of_signed_integers() {
        assert_eq!(mem::size_of::<i8>(), 1);
        assert_eq!(mem::size_of::<i16>(), 2);
        assert_eq!(mem::size_of::<i32>(), 4);
        assert_eq!(mem::size_of::<i64>(), 8);
        assert_eq!(mem::size_of::<i128>(), 16);
    }
}
