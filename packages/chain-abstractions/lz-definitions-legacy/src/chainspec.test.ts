import { describe, expect, it } from 'vitest';

import { ChainSpecs } from './chainspec';
import { Chain } from './enums/chain';

describe('StaticConfigManager', () => {
    describe('getAddressSizeInBytes', () => {
        it.each([
            // chain, expected
            [Chain.ETHEREUM, 20],
            [Chain.APTOS, 32],
            [Chain.SOLANA, 32],
            [Chain.CANTON, 32],
        ])('should return the address size in bytes for %s', (chain, expected) => {
            const addressSizeInBytes = ChainSpecs.getAddressSizeInBytes(chain);
            expect(addressSizeInBytes).toBe(expected);
        });
    });
});
