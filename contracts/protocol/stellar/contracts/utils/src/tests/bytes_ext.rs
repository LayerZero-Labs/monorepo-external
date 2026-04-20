use crate::{bytes_ext::BytesExt, tests::test_helper::assert_panics_contains};
use soroban_sdk::{Bytes, Env};

// ============================================
// Helper functions
// ============================================

/// Helper to assert that `to_array::<N>()` panics with BytesExtError::LengthMismatch (1400)
fn assert_to_array_panics<const N: usize>(case: &str, raw: &[u8]) {
    const EXPECTED: &str = "Error(Contract, #1040)"; // LengthMismatch
    assert_panics_contains(case, EXPECTED, || {
        let env = Env::default();
        let bytes = Bytes::from_slice(&env, raw);
        let _arr: [u8; N] = bytes.to_array();
    });
}

// ============================================
// Successful conversion tests
// ============================================

#[test]
fn test_to_array_various_sizes() {
    let env = Env::default();

    // Empty array
    let bytes = Bytes::from_array(&env, &[]);
    let arr: [u8; 0] = bytes.to_array();
    let expected: [u8; 0] = [];
    assert_eq!(arr, expected);

    // Single byte
    let bytes = Bytes::from_array(&env, &[0xAB]);
    assert_eq!(bytes.to_array::<1>(), [0xAB]);

    // Two bytes
    let bytes = Bytes::from_array(&env, &[0xAB, 0xCD]);
    assert_eq!(bytes.to_array::<2>(), [0xAB, 0xCD]);

    // Four bytes
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    assert_eq!(bytes.to_array::<4>(), [0x01, 0x02, 0x03, 0x04]);

    // Eight bytes - verify order preserved
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    let arr = bytes.to_array::<8>();
    assert_eq!(arr[0], 0x01);
    assert_eq!(arr[7], 0x08);

    // 32 bytes
    let data: [u8; 32] = [0x42; 32];
    let bytes = Bytes::from_array(&env, &data);
    assert_eq!(bytes.to_array::<32>(), data);

    // 64 bytes
    let data: [u8; 64] = core::array::from_fn(|i| i as u8);
    let bytes = Bytes::from_array(&env, &data);
    assert_eq!(bytes.to_array::<64>(), data);
}

#[test]
fn test_to_array_boundary_values() {
    let env = Env::default();

    // All zeros
    let data: [u8; 16] = [0x00; 16];
    let bytes = Bytes::from_array(&env, &data);
    let arr: [u8; 16] = bytes.to_array();
    assert_eq!(arr, data);

    // All ones
    let data: [u8; 16] = [0xFF; 16];
    let bytes = Bytes::from_array(&env, &data);
    let arr: [u8; 16] = bytes.to_array();
    assert_eq!(arr, data);

    // Boundary byte values
    let bytes = Bytes::from_array(&env, &[0x00, 0x7F, 0x80, 0xFF]);
    let arr: [u8; 4] = bytes.to_array();
    assert_eq!(arr[0], 0x00); // min
    assert_eq!(arr[1], 0x7F); // max positive signed
    assert_eq!(arr[2], 0x80); // min negative signed
    assert_eq!(arr[3], 0xFF); // max

    // Sequential values
    let data: [u8; 10] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let bytes = Bytes::from_array(&env, &data);
    let arr: [u8; 10] = bytes.to_array();
    for i in 0..10 {
        assert_eq!(arr[i], i as u8);
    }
}

// ============================================
// Length mismatch tests (error conditions)
// ============================================

#[test]
fn test_to_array_length_mismatch_panics_table() {
    // Bytes too short
    assert_to_array_panics::<4>("3 bytes to [u8; 4]", &[0x01, 0x02, 0x03]);
    // Bytes too long
    assert_to_array_panics::<4>("5 bytes to [u8; 4]", &[0x01, 0x02, 0x03, 0x04, 0x05]);
    // Empty to non-empty
    assert_to_array_panics::<4>("0 bytes to [u8; 4]", &[]);
    // Off-by-one short
    assert_to_array_panics::<8>("7 bytes to [u8; 8]", &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    // Off-by-one long
    assert_to_array_panics::<8>("9 bytes to [u8; 8]", &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    // Significantly wrong size
    assert_to_array_panics::<32>("4 bytes to [u8; 32]", &[0x01, 0x02, 0x03, 0x04]);
}

#[test]
fn test_to_array_large_sizes() {
    let env = Env::default();

    // Test with 128 bytes
    let data: [u8; 128] = core::array::from_fn(|i| (i % 256) as u8);
    let bytes = Bytes::from_array(&env, &data);
    assert_eq!(bytes.to_array::<128>(), data);

    // Test with 256 bytes
    let data: [u8; 256] = core::array::from_fn(|i| (i % 256) as u8);
    let bytes = Bytes::from_array(&env, &data);
    assert_eq!(bytes.to_array::<256>(), data);
}

#[test]
fn test_to_array_very_large_size() {
    let env = Env::default();

    // Test with 512 bytes to ensure it works beyond 256
    let data: [u8; 512] = core::array::from_fn(|i| (i % 256) as u8);
    let bytes = Bytes::from_array(&env, &data);
    let arr = bytes.to_array::<512>();

    // Verify first and last elements
    assert_eq!(arr[0], 0);
    assert_eq!(arr[255], 255);
    assert_eq!(arr[256], 0);
    assert_eq!(arr[511], 255);

    // Verify full array matches
    assert_eq!(arr, data);
}

#[test]
fn test_to_array_preserves_all_values() {
    let env = Env::default();

    // Test that all byte values (0-255) are preserved correctly
    let data: [u8; 256] = core::array::from_fn(|i| i as u8);
    let bytes = Bytes::from_array(&env, &data);
    let arr: [u8; 256] = bytes.to_array();

    for i in 0..256 {
        assert_eq!(arr[i], i as u8, "Mismatch at index {}", i);
    }
}
