export const isHexPrefixed = (hex: string): hex is `0x${string}` => hex.startsWith('0x');

export const ensureHexPrefix = (hex: string): `0x${string}` =>
    isHexPrefixed(hex) ? hex : `0x${hex}`;

export const stripHexPrefix = (hex: string): string => (isHexPrefixed(hex) ? hex.slice(2) : hex);

type BaseArtifactSnapshotSettings = {
    solcVersion: string;
    compiler: {
        evmVersion?: string;
        optimizer?: { enabled?: boolean; runs?: number; mode?: string };
        viaIR?: boolean;
        metadata?: { appendCBOR?: boolean; useLiteralContent?: boolean; bytecodeHash?: string };
    };
};

/**
 * Exactly one of `bytecodeHash` / `deployedBytecodeHash` must be set. Prefer
 * `bytecodeHash`; fall back to `deployedBytecodeHash` when the creation
 * bytecode has a tail after the runtime CBOR (e.g. OpenZeppelin v4/v5 proxies)
 * that breaks CBOR detection.
 */
type BytecodeHashAssertion =
    | { bytecodeHash: string; deployedBytecodeHash?: never }
    | { bytecodeHash?: never; deployedBytecodeHash: string };

/** Snapshot settings for EVM / Tron targets. */
export type ArtifactSnapshotSettings = BaseArtifactSnapshotSettings &
    BytecodeHashAssertion & {
        cborMetadata?: string;
    };

/**
 * Snapshot settings for ZKSync targets. Metadata form depends on zksolc
 * version (`cborMetadata` for >= 1.5.13, `metadataHash` otherwise), so
 * `zksolcVersion` is pinned to catch drift. Only `bytecodeHash` is supported.
 *
 * ZKSync `bytecode` is duplicated into `deployedBytecode`.
 */
export type ZKSyncArtifactSnapshotSettings = BaseArtifactSnapshotSettings & {
    bytecodeHash: string;
    zksolcVersion?: string;
} & (
        | { cborMetadata?: string; metadataHash?: never }
        | { cborMetadata?: never; metadataHash?: string }
    );

/**
 * Returns the end position of the CBOR item at `offset`, or `undefined` if
 * malformed. Handles the major types Solidity metadata uses: uint, bytes,
 * text, map, simple.
 */
const cborItemEnd = (data: Uint8Array, offset: number, depth = 0): number | undefined => {
    if (depth > 64) return undefined;
    if (offset >= data.length) return undefined;

    const major = data[offset] >> 5;
    const info = data[offset] & 0x1f;
    let pos = offset + 1;
    let arg: number;

    if (info < 24) arg = info;
    else if (info === 24 && pos < data.length) {
        arg = data[pos];
        pos += 1;
    } else if (info === 25 && pos + 1 < data.length) {
        arg = (data[pos] << 8) | data[pos + 1];
        pos += 2;
    } else if (info === 26 && pos + 3 < data.length) {
        arg =
            ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>>
            0;
        pos += 4;
    } else {
        return undefined;
    }

    switch (major) {
        case 0:
        case 1:
        case 7:
            return pos;
        case 2:
        case 3:
            return pos + arg <= data.length ? pos + arg : undefined;
        case 5: {
            let cursor = pos;
            for (let i = 0; i < arg * 2; i++) {
                const end = cborItemEnd(data, cursor, depth + 1);
                if (end === undefined) return undefined;
                cursor = end;
            }
            return cursor;
        }
        default:
            return undefined;
    }
};

const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
};

/**
 * Extracts the CBOR metadata blob from Solidity bytecode (length in last 2
 * bytes, blob immediately before). Returns `undefined` when absent (e.g.
 * `appendCBOR: false`) or malformed — validated by a full CBOR walk.
 */
export const extractCBORMetadata = (bytecode: string): string | undefined => {
    const hex = stripHexPrefix(bytecode);
    if (hex.length < 4) return undefined;

    const metadataLength = parseInt(hex.slice(-4), 16);
    if (metadataLength === 0 || metadataLength * 2 + 4 > hex.length) return undefined;

    const metadata = hex.slice(-4 - metadataLength * 2, -4);
    const bytes = hexToBytes(metadata);

    if (bytes[0] >> 5 !== 5) return undefined;
    if (cborItemEnd(bytes, 0) !== metadataLength) return undefined;

    return metadata;
};

/**
 * Returns the bytecode with the CBOR metadata suffix (blob + 2-byte length)
 * removed. If no valid CBOR metadata is found the bytecode is returned as-is.
 */
export const stripCBORMetadata = (bytecode: string): `0x${string}` => {
    const hex = stripHexPrefix(bytecode);
    const cbor = extractCBORMetadata(bytecode);
    if (cbor == null) return `0x${hex}`;
    // suffix = CBOR hex chars + 4 hex chars for the 2-byte length
    return `0x${hex.slice(0, hex.length - cbor.length - 4)}`;
};

/** EraVM binaries are a non-zero, odd number of 32-byte words. */
const isValidEraVMBinary = (hex: string): boolean => {
    const bytes = hex.length / 2;
    if (bytes === 0 || bytes % 32 !== 0) return false;
    return (bytes / 32) % 2 === 1;
};

/**
 * Extracts the metadata suffix from EraVM bytecode: CBOR + length for
 * `zksolc >= 1.5.13`, otherwise the last 32-byte keccak256 `Metadata` hash.
 * Returns `undefined` for non-EraVM binaries.
 */
export const extractZKSyncMetadata = (bytecode: string): string | undefined => {
    const hex = stripHexPrefix(bytecode);
    if (!isValidEraVMBinary(hex)) return undefined;

    const cbor = extractCBORMetadata(bytecode);
    if (cbor != null) return cbor;

    return hex.slice(-64);
};

/** Inverse of `extractZKSyncMetadata`; returns the bytecode as-is if invalid. */
export const stripZKSyncMetadata = (bytecode: string): `0x${string}` => {
    const hex = stripHexPrefix(bytecode);
    if (!isValidEraVMBinary(hex)) return `0x${hex}`;

    const cbor = extractCBORMetadata(bytecode);
    if (cbor != null) return `0x${hex.slice(0, hex.length - cbor.length - 4)}`;

    return `0x${hex.slice(0, hex.length - 64)}`;
};
