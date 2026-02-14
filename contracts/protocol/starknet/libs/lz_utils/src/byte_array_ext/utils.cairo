// SPDX-License-Identifier: MIT
// Based on code from Alexandria (https://github.com/keep-starknet-strange/alexandria)
// Copyright (c) 2023 Alexandria Contributors

use core::integer::u128_byte_reverse;

/// Reverses the endianness of a u256 value.
/// #### Arguments
/// * `input` - The u256 value to reverse endianness
/// #### Returns
/// * `u256` - The u256 value with reversed endianness
pub fn u256_reverse_endian(input: u256) -> u256 {
    let low = u128_byte_reverse(input.high);
    let high = u128_byte_reverse(input.low);
    u256 { low, high }
}
