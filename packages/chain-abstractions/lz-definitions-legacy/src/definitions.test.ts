import { describe, expect, it } from 'vitest';

import { CHAIN_KEY, ENVIRONMENT } from './constants';
import { Chain, ChainKey, EndpointId } from './enums';

describe('Definitions', () => {
    it('Chain', () => {
        expect(Chain).toMatchSnapshot();
    });
    it('ChainKey', () => {
        expect(ChainKey).toMatchSnapshot();
    });
    it('CHAIN_KEY', () => {
        expect(CHAIN_KEY).toMatchSnapshot();
    });
    it('ENVIRONMENT', () => {
        expect(ENVIRONMENT).toMatchSnapshot();
    });
    it('EndpointId', () => {
        expect(EndpointId).toMatchSnapshot();
    });
});
