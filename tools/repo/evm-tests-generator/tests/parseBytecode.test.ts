import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import { stripCBORMetadata, stripZKSyncMetadata } from '../src/common';
import { extractFromBytecode } from '../src/parseBytecode';
import { CREATEX_BYTECODE, CREATEX_STRIPPED_BYTECODE } from './fixtures/bytecodes';
import {
    ZKSYNC_BYTECODE_WITH_CBOR,
    ZKSYNC_BYTECODE_WITH_RAW_HASH,
    ZKSYNC_CBOR_METADATA,
    ZKSYNC_RAW_METADATA_HASH,
} from './fixtures/zksyncBytecodes';

// body: 6080 | cbor: a164736f6c6343000816 (10 bytes) | len: 000a
const BYTECODE_WITH_CBOR = '0x6080a164736f6c6343000816000a';
const BYTECODE_WITHOUT_CBOR = '0x6080604052';

describe('extractFromBytecode', () => {
    it('extracts hash and CBOR from bytecode with metadata', () => {
        const result = extractFromBytecode(BYTECODE_WITH_CBOR);

        expect(result).toMatchObject({
            bytecodeHash: keccak256(stripCBORMetadata(BYTECODE_WITH_CBOR)),
            cborMetadata: 'a164736f6c6343000816',
        });
    });

    it('returns undefined cborMetadata when bytecode has none', () => {
        const result = extractFromBytecode(BYTECODE_WITHOUT_CBOR);

        expect(result).toMatchObject({ bytecodeHash: keccak256(BYTECODE_WITHOUT_CBOR) });
        expect(result.cborMetadata).toBeUndefined();
    });

    it('handles input without 0x prefix', () => {
        const withPrefix = extractFromBytecode(BYTECODE_WITH_CBOR);
        const withoutPrefix = extractFromBytecode(BYTECODE_WITH_CBOR.slice(2));

        expect(withoutPrefix).toEqual(withPrefix);
    });

    it('matches CreateX bytecode expectations', () => {
        const result = extractFromBytecode(CREATEX_BYTECODE);

        expect(result).toMatchObject({
            bytecodeHash: keccak256(CREATEX_STRIPPED_BYTECODE),
            cborMetadata: 'a164736f6c6343000817',
        });
    });

    it('throws on invalid hex characters', () => {
        expect(() => extractFromBytecode('0xGGGG')).toThrow('Invalid hex string');
    });

    it('throws on odd-length hex', () => {
        expect(() => extractFromBytecode('0x608')).toThrow('Invalid hex string');
    });

    it('throws on empty bytecode', () => {
        expect(() => extractFromBytecode('0x')).toThrow('Bytecode is empty');
        expect(() => extractFromBytecode('')).toThrow('Bytecode is empty');
    });

    it('matches EVM behavior for target: tron', () => {
        expect(extractFromBytecode(BYTECODE_WITH_CBOR, 'tron')).toEqual(
            extractFromBytecode(BYTECODE_WITH_CBOR, 'evm'),
        );
    });

    it('emits deployedBytecodeHash instead of bytecodeHash when deployed: true', () => {
        const result = extractFromBytecode(BYTECODE_WITH_CBOR, { deployed: true });

        expect(result).toEqual({
            deployedBytecodeHash: keccak256(stripCBORMetadata(BYTECODE_WITH_CBOR)),
            cborMetadata: 'a164736f6c6343000816',
        });
    });

    it('rejects deployed: true for ZKSync target (no creation/runtime split)', () => {
        expect(() =>
            extractFromBytecode(ZKSYNC_BYTECODE_WITH_CBOR, { target: 'zksync', deployed: true }),
        ).toThrow(/not supported for the `zksync` target/);
    });

    it('extracts cborMetadata for new zksolc (>= 1.5.13) ZKSync bytecodes', () => {
        expect(extractFromBytecode(ZKSYNC_BYTECODE_WITH_CBOR, 'zksync')).toMatchObject({
            bytecodeHash: keccak256(stripZKSyncMetadata(ZKSYNC_BYTECODE_WITH_CBOR)),
            cborMetadata: ZKSYNC_CBOR_METADATA,
        });
    });

    it('extracts metadataHash for old zksolc (< 1.5.13) ZKSync bytecodes', () => {
        expect(extractFromBytecode(ZKSYNC_BYTECODE_WITH_RAW_HASH, 'zksync')).toMatchObject({
            bytecodeHash: keccak256(stripZKSyncMetadata(ZKSYNC_BYTECODE_WITH_RAW_HASH)),
            metadataHash: ZKSYNC_RAW_METADATA_HASH,
        });
    });
});
