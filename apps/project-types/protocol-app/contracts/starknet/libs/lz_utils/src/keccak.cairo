use core::keccak::compute_keccak_byte_array;
use crate::byte_array_ext::utils::u256_reverse_endian;
use crate::bytes::Bytes32;

/// Computes the keccak256 hash of a byte array and returns it as a u256 value
///
/// # Arguments
/// * `arr` - A reference to a byte array to be hashed
///
/// # Returns
/// * `Bytes32` - The keccak256 hash of the input as a u256
pub fn keccak256(arr: @ByteArray) -> Bytes32 {
    Bytes32 { value: u256_reverse_endian(compute_keccak_byte_array(arr)) }
}
