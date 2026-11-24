// EraVM bytecode must be an odd number of 32-byte words.
// These are minimal synthetic fixtures for testing metadata extraction.

// --- Old zksolc (< 1.5.13): raw keccak256 metadata hash in last word ---
//
// 3 words (96 bytes): 2 words body + 1 word metadata hash.
const ZKSYNC_OLD_BODY =
    '6080604052000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000001';

export const ZKSYNC_RAW_METADATA_HASH =
    'f953dab1c008cb3c8ddf628825fe0a49d69111fb522bfdb6269e8d6dd623dbf9';

export const ZKSYNC_BYTECODE_WITH_RAW_HASH =
    `0x${ZKSYNC_OLD_BODY}${ZKSYNC_RAW_METADATA_HASH}` as const;

// --- New zksolc (>= 1.5.13): CBOR-encoded metadata + 2-byte length suffix ---
//
// CBOR: solc-only map(1), text(4) "solc", bytes(3) <0.8.23> = 10 bytes.
// Length suffix: 000a (10 in big-endian u16).
// Total suffix: 12 bytes = 24 hex chars.
// Body: 96 - 12 = 84 bytes = 168 hex chars (3 words total, odd ✓).
export const ZKSYNC_CBOR_METADATA = 'a164736f6c6343000817';

// 168 hex chars of body (84 bytes)
const ZKSYNC_NEW_BODY =
    '6080604052000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000002';

export const ZKSYNC_BYTECODE_WITH_CBOR = `0x${ZKSYNC_NEW_BODY}${ZKSYNC_CBOR_METADATA}000a` as const;
