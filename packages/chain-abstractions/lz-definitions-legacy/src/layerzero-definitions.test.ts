import { describe, expect, it } from 'vitest';

import {
    ChainName,
    EndpointVersion as LayerZeroEndpointVersion,
    Environment,
} from '@layerzerolabs/layerzero-definitions';

import { Chain, EndpointVersion, Stage } from './enums';

describe('layerzero-definitions', () => {
    it('every ChainName is a Chain', () => {
        const chains = new Set<string>(Object.values(Chain));
        expect(Object.values(ChainName).filter((name) => !chains.has(name))).toEqual([]);
    });

    it('Environment is Stage', () => {
        expect(Object.values(Environment).sort()).toEqual(Object.values(Stage).sort());
    });

    it('EndpointVersion is the same', () => {
        expect(Object.values(LayerZeroEndpointVersion).sort()).toEqual(
            Object.values(EndpointVersion).sort(),
        );
    });
});
