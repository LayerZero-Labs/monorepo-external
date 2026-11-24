import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import type { HexString } from '@layerzerolabs/common-chain-model';
import { ensure0xPrefixed } from '@layerzerolabs/common-encoding-utils';

import {
    hexToStellarAccountAddress,
    hexToStellarContractAddress,
    normalizedToStellarAscii,
    stellarAccountHexToNormalized,
    stellarAddressToHex,
    stellarAsciiToNormalized,
    stellarContractHexToNormalized,
    stellarNormalizedToHex,
} from '../src/index';

const ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const toHex = (bytes: Buffer): HexString => `0x${bytes.toString('hex')}` as HexString;

describe('hexToStellarContractAddress', () => {
    it('rejects hex payloads that are not 32 bytes', () => {
        expect(() => hexToStellarContractAddress(`0x${'11'.repeat(20)}`)).toThrow(
            /must be exactly 32 bytes, got 20/,
        );
        expect(() => hexToStellarAccountAddress(`0x${'11'.repeat(33)}` as HexString)).toThrow(
            /must be exactly 32 bytes, got 33/,
        );
    });

    it('passes through StrKey strings and maps empty input to the zero contract', () => {
        expect(hexToStellarContractAddress(CONTRACT)).toBe(CONTRACT);
        expect(hexToStellarContractAddress(ACCOUNT)).toBe(ACCOUNT);
        expect(hexToStellarContractAddress('')).toBe(StrKey.encodeContract(Buffer.alloc(32)));
    });

    it('does not treat unprefixed hex that starts with C as a StrKey', () => {
        // 32-byte unprefixed hex beginning with `c` — must encode as contract id, not pass through.
        const unprefixed = 'c1'.repeat(32);
        expect(hexToStellarContractAddress(unprefixed)).toBe(
            StrKey.encodeContract(Buffer.from(unprefixed, 'hex')),
        );
    });
});

const MUXED = 'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ';
const SIGNED_PAYLOAD =
    'PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAQACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IBZGM';

describe('stellarAddressToHex', () => {
    it('encodes contract and account addresses to their 32-byte payload', () => {
        expect(stellarAddressToHex(CONTRACT)).toBe(toHex(StrKey.decodeContract(CONTRACT)));
        expect(stellarAddressToHex(ACCOUNT)).toBe(toHex(StrKey.decodeEd25519PublicKey(ACCOUNT)));
    });

    it('matches stellarNormalizedToHex for the same address', () => {
        const normalized = stellarAsciiToNormalized(CONTRACT);
        expect(stellarNormalizedToHex(normalized)).toBe(stellarAddressToHex(CONTRACT));
    });

    it('rejects native address types that do not fit 32 bytes', () => {
        expect(() => stellarAddressToHex(MUXED)).toThrow(/not supported for muxed/);
        expect(() => stellarAddressToHex(SIGNED_PAYLOAD)).toThrow(
            /not supported for signed payload/,
        );
    });
});

describe('stellarContractHexToNormalized', () => {
    it('round-trips a contract payload back to its StrKey', () => {
        expect(stellarContractHexToNormalized(stellarAddressToHex(CONTRACT))).toBe(
            stellarAsciiToNormalized(CONTRACT),
        );
    });

    it('encodes the payload as a C… contract, whatever the payload came from', () => {
        const accountHex = stellarAddressToHex(ACCOUNT);

        expect(normalizedToStellarAscii(stellarContractHexToNormalized(accountHex))).toBe(
            StrKey.encodeContract(StrKey.decodeEd25519PublicKey(ACCOUNT)),
        );
    });

    it('rejects StrKey input rather than silently passing it through', () => {
        expect(() => stellarContractHexToNormalized(ensure0xPrefixed(CONTRACT))).toThrow(
            'invalid hex string (length 58)',
        );
        expect(() => stellarContractHexToNormalized(ensure0xPrefixed(MUXED))).toThrow(
            /invalid hex string/,
        );
    });

    it('rejects non-32-byte hex and empty string', () => {
        expect(() => stellarContractHexToNormalized(`0x${'00'.repeat(20)}`)).toThrow(
            'Stellar address payload must be exactly 32 bytes, got 20',
        );
        expect(() => stellarContractHexToNormalized('')).toThrow(
            'Stellar address payload must be exactly 32 bytes, got 0',
        );
    });
});

describe('stellarAccountHexToNormalized', () => {
    it('round-trips an account payload back to its StrKey', () => {
        expect(stellarAccountHexToNormalized(stellarAddressToHex(ACCOUNT))).toBe(
            stellarAsciiToNormalized(ACCOUNT),
        );
    });

    it('encodes the payload as a G… account, whatever the payload came from', () => {
        const contractHex = stellarAddressToHex(CONTRACT);

        expect(normalizedToStellarAscii(stellarAccountHexToNormalized(contractHex))).toBe(
            StrKey.encodeEd25519PublicKey(StrKey.decodeContract(CONTRACT)),
        );
    });

    it('differs from the contract encoding for the same payload', () => {
        const payloadHex = stellarAddressToHex(CONTRACT);

        expect(stellarAccountHexToNormalized(payloadHex)).not.toBe(
            stellarContractHexToNormalized(payloadHex),
        );
    });

    it('rejects StrKey input rather than silently passing it through', () => {
        expect(() => stellarAccountHexToNormalized(ensure0xPrefixed(ACCOUNT))).toThrow(
            'invalid hex string (length 58)',
        );
    });

    it('rejects non-32-byte hex and empty string', () => {
        expect(() => stellarAccountHexToNormalized(`0x${'00'.repeat(20)}`)).toThrow(
            'Stellar address payload must be exactly 32 bytes, got 20',
        );
        expect(() => stellarAccountHexToNormalized('')).toThrow(
            'Stellar address payload must be exactly 32 bytes, got 0',
        );
    });
});
