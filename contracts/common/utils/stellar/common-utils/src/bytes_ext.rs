use crate::errors::BytesExtError;
use soroban_sdk::{assert_with_error, Bytes};

/// Extension trait for `Bytes` to convert to fixed-size arrays
pub trait BytesExt {
    /// Copies the entire bytes into a fixed-size array.
    /// Panics if bytes length != N.
    fn to_array<const N: usize>(&self) -> [u8; N];
}

impl BytesExt for Bytes {
    fn to_array<const N: usize>(&self) -> [u8; N] {
        assert_with_error!(self.env(), self.len() == N as u32, BytesExtError::LengthMismatch);
        let mut buf = [0u8; N];
        self.copy_into_slice(&mut buf);
        buf
    }
}
