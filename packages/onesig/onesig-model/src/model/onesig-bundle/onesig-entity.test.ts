import { describe, expect, it } from 'vitest';

import { bundleExpiryToMs, MAX_BUNDLE_EXPIRY_SECONDS } from './onesig-entity';

describe('bundleExpiryToMs', () => {
    const expiryMs = Date.parse('2026-07-26T20:00:00.000Z');

    it('converts an expiry in seconds', () => {
        expect(bundleExpiryToMs(expiryMs / 1000)).toBe(expiryMs);
    });

    it('passes a legacy expiry in milliseconds through unchanged', () => {
        expect(bundleExpiryToMs(expiryMs)).toBe(expiryMs);
    });

    it('treats the bound itself as seconds', () => {
        expect(bundleExpiryToMs(MAX_BUNDLE_EXPIRY_SECONDS)).toBe(MAX_BUNDLE_EXPIRY_SECONDS * 1000);
    });
});
