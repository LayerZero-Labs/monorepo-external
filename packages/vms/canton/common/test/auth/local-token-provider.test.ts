import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalTokenProvider } from '../../src/auth/local-token-provider';

function decodeJwtPayload(token: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT');
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
    return JSON.parse(payload);
}

describe('LocalTokenProvider', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('generates a JWT with expected claims', async () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        const provider = new LocalTokenProvider({
            userId: 'test-user',
            actAs: ['party1::abc', 'party2::def'],
        });

        const token = await provider.getToken();
        const payload = decodeJwtPayload(token);

        expect(payload).toMatchObject({
            sub: 'test-user',
            aud: 'https://canton.network.global',
            iat: Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000),
            'https://daml.com/ledger-api': {
                ledgerId: null,
                participantId: null,
                applicationId: null,
                actAs: ['party1::abc', 'party2::def'],
                readAs: ['party1::abc', 'party2::def'],
                admin: true,
            },
        });

        const iat = payload['iat'] as number;
        const exp = payload['exp'] as number;
        expect(exp - iat).toBe(3600);
    });

    it('uses custom config values', async () => {
        const provider = new LocalTokenProvider({
            userId: 'custom-user',
            actAs: ['p1::123'],
            secret: 'my-secret',
            audience: 'https://custom.audience',
            expiresIn: 600,
            admin: false,
        });

        const token = await provider.getToken();
        const payload = decodeJwtPayload(token);

        expect(payload['sub']).toBe('custom-user');
        expect(payload['aud']).toBe('https://custom.audience');
        const ledgerApi = payload['https://daml.com/ledger-api'] as Record<string, unknown>;
        expect(ledgerApi['admin']).toBe(false);

        const iat = payload['iat'] as number;
        const exp = payload['exp'] as number;
        expect(exp - iat).toBe(600);
    });

    it('returns cached token on subsequent calls within TTL', async () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        const provider = new LocalTokenProvider({
            userId: 'test-user',
            actAs: ['party::abc'],
            expiresIn: 3600,
        });

        const token1 = await provider.getToken();

        // Advance 30 minutes — well within TTL (3600s - 60s buffer = 3540s)
        vi.advanceTimersByTime(30 * 60 * 1000);

        const token2 = await provider.getToken();
        expect(token2).toBe(token1);
    });

    it('regenerates token after expiry buffer', async () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        const provider = new LocalTokenProvider({
            userId: 'test-user',
            actAs: ['party::abc'],
            expiresIn: 120, // 2 minutes, minus 60s buffer = valid for 60s
        });

        const token1 = await provider.getToken();

        // Advance past the buffer threshold (120s - 60s = 60s)
        vi.advanceTimersByTime(61 * 1000);

        const token2 = await provider.getToken();
        expect(token2).not.toBe(token1);

        // New token should have updated iat/exp
        const payload = decodeJwtPayload(token2);
        const expectedIat = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000) + 61;
        expect(payload['iat']).toBe(expectedIat);
    });

    it('produces a three-part JWT string', async () => {
        const provider = new LocalTokenProvider({
            userId: 'u',
            actAs: ['p::1'],
        });

        const token = await provider.getToken();
        const parts = token.split('.');
        expect(parts).toHaveLength(3);

        // Header should decode to HS256
        const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf-8'));
        expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    });
});
