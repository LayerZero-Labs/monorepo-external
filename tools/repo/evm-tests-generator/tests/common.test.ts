import { describe, expect, it } from 'vitest';

import { extractCBORMetadata, stripCBORMetadata } from '../src/common';
import { CREATEX_BYTECODE, CREATEX_STRIPPED_BYTECODE } from './fixtures/bytecodes';

describe('extractCBORMetadata', () => {
    // `appendCBOR: false` removes the CBOR suffix entirely.
    it('returns undefined for bytecode without CBOR', () => {
        const bytecodeWithoutCbor = '0x6080604052600080fd01';
        expect(extractCBORMetadata(bytecodeWithoutCbor)).toBeUndefined();
        expect(stripCBORMetadata(bytecodeWithoutCbor)).toBe(bytecodeWithoutCbor);
    });

    // Canonical CreateX: compiled with `bytecodeHash: 'none'` — CBOR has only solc version, no content hash.
    // map(1) | text(4) "solc" | bytes(3) <0.8.23>
    it('extracts solc-only CBOR metadata (CreateX, bytecodeHash: none)', () => {
        const solcOnlyCbor = 'a164736f6c6343000817';
        expect(extractCBORMetadata(CREATEX_BYTECODE)).toBe(solcOnlyCbor);
        expect(stripCBORMetadata(CREATEX_BYTECODE)).toBe(CREATEX_STRIPPED_BYTECODE);
    });

    // Standard Solidity CBOR with IPFS content hash (51 bytes total).
    // map(2) | text(4) "ipfs" | bytes(34) <IPFS CIDv0 multihash> | text(4) "solc" | bytes(3) <0.8.22>
    it('extracts CBOR metadata with IPFS hash', () => {
        const ipfsCbor =
            'a264697066735822122044e781eefdd3ad54e5d30945665f5494ea12a8329dcb90497038c706dd295f0164736f6c6343000816';
        const bytecode = `0x6080${ipfsCbor}0033`;
        expect(extractCBORMetadata(bytecode)).toBe(ipfsCbor);
        expect(stripCBORMetadata(bytecode)).toBe('0x6080');
    });

    // Solidity CBOR with bzzr1 (Swarm) content hash (50 bytes total).
    // map(2) | text(5) "bzzr1" | bytes(32) <Swarm hash> | text(4) "solc" | bytes(3) <0.8.23>
    it('extracts CBOR metadata with bzzr1 hash', () => {
        const bzzr1Cbor =
            'a265627a7a7231582070658e3d475096461e901ea7ca373e22f645d2f29928248102966ec80432417264736f6c6343000817';
        const bytecode = `0x6080${bzzr1Cbor}0032`;
        expect(extractCBORMetadata(bytecode)).toBe(bzzr1Cbor);
        expect(stripCBORMetadata(bytecode)).toBe('0x6080');
    });
});
