const UUID_BYTE_LENGTH = 16;

export type UuidVersion = 4 | 5;

const prepareUuidBytes = (bytes: Uint8Array): Uint8Array => {
    if (bytes.length === 0) {
        throw new Error('uuid bytes must not be empty');
    }

    if (bytes.length === UUID_BYTE_LENGTH) {
        return new Uint8Array(bytes);
    }

    if (bytes.length > UUID_BYTE_LENGTH) {
        return Uint8Array.from(bytes.subarray(0, UUID_BYTE_LENGTH));
    }

    const padded = new Uint8Array(UUID_BYTE_LENGTH);
    padded.set(bytes);
    return padded;
};

const formatUuidFrom16Bytes = (working: Uint8Array, version: UuidVersion): string => {
    const versionBits = version === 4 ? 0x40 : 0x50;
    // Set version (4 or 5) and variant (10xx)
    working[6] = (working[6]! & 0x0f) | versionBits;
    working[8] = (working[8]! & 0x3f) | 0x80;

    const hex = Array.from(working, (b) => b.toString(16).padStart(2, '0'));
    return (
        hex.slice(0, 4).join('') +
        '-' +
        hex.slice(4, 6).join('') +
        '-' +
        hex.slice(6, 8).join('') +
        '-' +
        hex.slice(8, 10).join('') +
        '-' +
        hex.slice(10, 16).join('')
    );
};

/**
 * Converts bytes into an RFC 4122 UUID string. Inputs longer than 16 bytes use
 * the first 16; shorter inputs are zero-padded on the right. Empty input throws.
 * Default `version` is 4 (UUID v4); pass `5` for name-based hashes, etc.
 */
export const uuidFromBytes = (bytes: Uint8Array, version: UuidVersion = 4): string =>
    formatUuidFrom16Bytes(prepareUuidBytes(bytes), version);
