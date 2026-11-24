import { describe, expect, it } from 'vitest';

import {
    derEncodeSignature,
    publicKeyToSpkiDer,
    SECP256K1_SPKI_DER_HEADER,
    SECP256K1_SPKI_DER_HEADER_HEX,
} from '../src/crypto';

// A throwaway uncompressed secp256k1 public key shape (0x04 ‖ X ‖ Y, 65 bytes).
const UNCOMPRESSED_KEY = `04${'ab'.repeat(64)}`;

describe('SECP256K1_SPKI_DER_HEADER', () => {
    it('is the canonical 23-byte secp256k1 SPKI-DER header', () => {
        expect(SECP256K1_SPKI_DER_HEADER).toHaveLength(23);
        expect(SECP256K1_SPKI_DER_HEADER_HEX).toBe(
            '3056301006072a8648ce3d020106052b8104000a034200',
        );
        expect(SECP256K1_SPKI_DER_HEADER_HEX).toHaveLength(46);
    });
});

describe('publicKeyToSpkiDer', () => {
    it('prepends the SPKI-DER header to the uncompressed key body', () => {
        const spki = publicKeyToSpkiDer(`0x${UNCOMPRESSED_KEY}`);
        expect(spki).toBe(SECP256K1_SPKI_DER_HEADER_HEX + UNCOMPRESSED_KEY);
        expect(spki).toHaveLength(46 + 130);
    });

    it('lowercases and tolerates a missing 0x prefix', () => {
        expect(publicKeyToSpkiDer(UNCOMPRESSED_KEY.toUpperCase())).toBe(
            SECP256K1_SPKI_DER_HEADER_HEX + UNCOMPRESSED_KEY,
        );
    });

    it('rejects a non-uncompressed (wrong-length or non-0x04) key', () => {
        expect(() => publicKeyToSpkiDer('0x02abcd')).toThrow();
        expect(() => publicKeyToSpkiDer(`03${'ab'.repeat(64)}`)).toThrow();
    });
});

describe('derEncodeSignature', () => {
    it('DER-encodes (r, s) as SEQUENCE { INTEGER r, INTEGER s } with minimal integers', () => {
        // r = 1, s = 2 → 30 06 02 01 01 02 01 02
        expect(derEncodeSignature('01', '02')).toBe('3006020101020102');
    });

    it('prepends 0x00 to an integer whose high bit is set', () => {
        // r = 0xff (high bit set, needs a leading 0x00), s = 1
        expect(derEncodeSignature('ff', '01')).toBe('3007020200ff020101');
    });
});
