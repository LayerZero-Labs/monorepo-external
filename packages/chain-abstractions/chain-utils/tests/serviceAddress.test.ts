import { describe, expect, it } from 'vitest';

import { stellarAddressToHex } from '@layerzerolabs/address-utils-stellar';
import { ChainName } from '@layerzerolabs/layerzero-definitions';

import { addressParser, serviceAddressToNormalized } from '../src';

const STELLAR_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const STELLAR_ACCOUNT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

describe('serviceAddressToNormalized', () => {
    const stellar = addressParser(ChainName.STELLAR);

    it('reads Stellar bytes32 as a contract when the caller declares C', () => {
        const hex = stellarAddressToHex(STELLAR_CONTRACT);

        expect(
            serviceAddressToNormalized(ChainName.STELLAR, hex, {
                stellar: { strKeyPrefix: 'C' },
            }),
        ).toBe(stellar.parseNative(STELLAR_CONTRACT));
    });

    it('reads Stellar bytes32 as an account when the caller declares G', () => {
        const hex = stellarAddressToHex(STELLAR_ACCOUNT);

        expect(
            serviceAddressToNormalized(ChainName.STELLAR, hex.slice(2), {
                stellar: { strKeyPrefix: 'G' },
            }),
        ).toBe(stellar.parseNative(STELLAR_ACCOUNT));
    });

    it('parses a Stellar StrKey as native, whatever prefix the caller declares', () => {
        expect(
            serviceAddressToNormalized(ChainName.STELLAR, STELLAR_CONTRACT, {
                stellar: { strKeyPrefix: 'G' },
            }),
        ).toBe(stellar.parseNative(STELLAR_CONTRACT));
        expect(
            serviceAddressToNormalized(ChainName.STELLAR, STELLAR_ACCOUNT, {
                stellar: { strKeyPrefix: 'C' },
            }),
        ).toBe(stellar.parseNative(STELLAR_ACCOUNT));
    });

    it('parses other chains as native addresses', () => {
        expect(
            serviceAddressToNormalized(ChainName.ETHEREUM, EVM_ADDRESS, {
                stellar: { strKeyPrefix: 'C' },
            }),
        ).toBe(addressParser(ChainName.ETHEREUM).parseNative(EVM_ADDRESS));
    });
});
