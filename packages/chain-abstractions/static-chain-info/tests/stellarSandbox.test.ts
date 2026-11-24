import { describe, expect, it } from 'vitest';

import { ChainName, EndpointVersion, Environment } from '@layerzerolabs/layerzero-definitions';

import {
    getChainNameFromEndpointId,
    getEndpointId,
    getEnvironmentFromEndpointId,
    getVId,
} from '../src';

describe('Stellar sandbox endpoint id', () => {
    it('maps Stellar sandbox V2 to 50600 and back', () => {
        const endpointId = getEndpointId(
            ChainName.STELLAR,
            Environment.SANDBOX,
            EndpointVersion.V2,
        );
        expect(endpointId).toBe(50600);
        expect(getChainNameFromEndpointId(endpointId)).toBe(ChainName.STELLAR);
        expect(getEnvironmentFromEndpointId(endpointId)).toBe(Environment.SANDBOX);
        expect(getVId(ChainName.STELLAR, Environment.SANDBOX)).toBe('20600');
    });
});
