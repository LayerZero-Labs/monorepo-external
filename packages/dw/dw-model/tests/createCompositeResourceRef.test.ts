import { describe, expect, it } from 'vitest';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import {
    createCompositeResourceRef,
    listEntryFromCompositeRef,
    parseCompositeResourceRef,
} from '@layerzerolabs/dw-model';

const RESOURCE_ID = 'my-example-oft-mint-burn-solana-devnet';

describe('createCompositeResourceRef', () => {
    it('returns resourceId when subkey is absent', () => {
        expect(createCompositeResourceRef({ resourceId: RESOURCE_ID })).toBe(RESOURCE_ID);
    });

    it('joins resourceId and resourceSubKey', () => {
        expect(
            createCompositeResourceRef({
                resourceId: RESOURCE_ID,
                resourceSubKey: 'factory',
            }),
        ).toBe(`${RESOURCE_ID}/factory`);
    });

    it('rejects empty resourceId', () => {
        expect(() => createCompositeResourceRef({ resourceId: '' })).toThrow(NonRetryableError);
    });

    it('rejects resourceId containing /', () => {
        expect(() => createCompositeResourceRef({ resourceId: 'a/b' })).toThrow(NonRetryableError);
        expect(() => createCompositeResourceRef({ resourceId: 'a/b' })).toThrow(
            'resourceId cannot include the character / (forward slash)',
        );
    });

    it('rejects empty-string resourceSubKey', () => {
        expect(() =>
            createCompositeResourceRef({
                resourceId: RESOURCE_ID,
                resourceSubKey: '',
            }),
        ).toThrow(NonRetryableError);
    });

    it('rejects resourceSubKey containing /', () => {
        expect(() =>
            createCompositeResourceRef({
                resourceId: RESOURCE_ID,
                resourceSubKey: 'foo/bar',
            }),
        ).toThrow(NonRetryableError);
        expect(() =>
            createCompositeResourceRef({
                resourceId: RESOURCE_ID,
                resourceSubKey: 'foo/bar',
            }),
        ).toThrow('resourceSubKey cannot include the character / (forward slash)');
    });
});

describe('parseCompositeResourceRef', () => {
    it('round-trips refs with and without subkeys', () => {
        expect(parseCompositeResourceRef(RESOURCE_ID)).toEqual({ resourceId: RESOURCE_ID });
        expect(parseCompositeResourceRef(`${RESOURCE_ID}/factory`)).toEqual({
            resourceId: RESOURCE_ID,
            resourceSubKey: 'factory',
        });
        expect(
            createCompositeResourceRef(parseCompositeResourceRef(`${RESOURCE_ID}/factory`)),
        ).toBe(`${RESOURCE_ID}/factory`);
    });

    it('rejects empty composite, empty segments, and nested slashes', () => {
        expect(() => parseCompositeResourceRef('')).toThrow(NonRetryableError);
        expect(() => parseCompositeResourceRef('/factory')).toThrow(NonRetryableError);
        expect(() => parseCompositeResourceRef(`${RESOURCE_ID}/`)).toThrow(NonRetryableError);
        expect(() => parseCompositeResourceRef(`${RESOURCE_ID}/foo/bar`)).toThrow(
            NonRetryableError,
        );
        expect(() => parseCompositeResourceRef(`${RESOURCE_ID}/foo/bar`)).toThrow(
            'resourceSubKey cannot include the character / (forward slash)',
        );
    });
});

describe('listEntryFromCompositeRef', () => {
    it('returns structured list rows without composite resourceId', () => {
        const realId = { realIdKey: '0xabc' };
        expect(listEntryFromCompositeRef(RESOURCE_ID, realId)).toEqual({
            resourceId: RESOURCE_ID,
            realId,
        });
        expect(listEntryFromCompositeRef(`${RESOURCE_ID}/factory`, realId)).toEqual({
            resourceId: RESOURCE_ID,
            resourceSubKey: 'factory',
            realId,
        });
    });
});
