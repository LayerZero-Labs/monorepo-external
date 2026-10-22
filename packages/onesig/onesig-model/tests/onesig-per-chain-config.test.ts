import { describe, expect, it } from 'vitest';

import { oneSigPerChainConfigSchema } from '../src/model/onesig-config/onesig-config';
import {
    findOneSigSolanaProgramAddress,
    getOneSigSolanaProgramAddress,
} from '../src/model/onesig-config/solana-program-ids';

const perChainConfig = {
    contractAddress: '9KHoyp3487NecjSreTJmPbZLd8ABeFTZeGGDXszXzMSE',
    signingConfig: 'signing-hash',
};

describe('oneSigPerChainConfigSchema', () => {
    it('parses a config with fundingAddress', () => {
        const config = {
            ...perChainConfig,
            fundingAddress: 'AtrGisNYXS6nVLg14ZLmG3KsLnbYeLzwP5ia6MSBZiWE',
        };
        expect(oneSigPerChainConfigSchema.parse(config)).toEqual(config);
    });

    it('parses a config without fundingAddress', () => {
        const parsed = oneSigPerChainConfigSchema.parse(perChainConfig);
        expect(parsed).toEqual(perChainConfig);
        expect(parsed.fundingAddress).toBeUndefined();
    });
});

describe('findOneSigSolanaProgramAddress', () => {
    it('returns the program address where deployed', () => {
        expect(findOneSigSolanaProgramAddress('testnet')).toEqual(
            getOneSigSolanaProgramAddress('testnet'),
        );
    });

    it.each(['sandbox', 'localnet', 'unknown'])('returns undefined for %s', (environment) => {
        expect(findOneSigSolanaProgramAddress(environment)).toBeUndefined();
        expect(() => getOneSigSolanaProgramAddress(environment)).toThrow(
            `not deployed for environment ${environment}`,
        );
    });
});
