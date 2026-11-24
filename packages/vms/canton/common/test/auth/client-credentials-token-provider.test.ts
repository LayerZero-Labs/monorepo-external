import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientCredentialsTokenProvider } from '../../src/auth/client-credentials-token-provider';

const TOKEN_URL = 'https://idp.example.com/realms/canton/protocol/openid-connect/token';
const CLIENT_ID = 'my-backend';
const CLIENT_SECRET = 'super-secret';

function mockTokenResponse(accessToken: string, expiresIn: number) {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: expiresIn,
        }),
        text: async () => '',
    } as unknown as Response;
}

function mockErrorResponse(status: number, body: string) {
    return {
        ok: false,
        status,
        statusText: 'Bad Request',
        json: async () => ({}),
        text: async () => body,
    } as unknown as Response;
}

describe('ClientCredentialsTokenProvider', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('fetches a token from the IdP', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockTokenResponse('tok-abc', 3600));

        const provider = new ClientCredentialsTokenProvider({
            tokenUrl: TOKEN_URL,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        });

        const token = await provider.getToken();

        expect(token).toBe('tok-abc');
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: expect.stringContaining('grant_type=client_credentials'),
        });
    });

    it('sends scope and audience when configured', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(mockTokenResponse('tok-scoped', 3600));

        const provider = new ClientCredentialsTokenProvider({
            tokenUrl: TOKEN_URL,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            scope: 'daml_ledger_api',
            audience: 'https://canton.network.global',
        });

        await provider.getToken();

        const body = vi.mocked(fetch).mock.calls[0]![1]!.body as string;
        const params = new URLSearchParams(body);
        expect(params.get('scope')).toBe('daml_ledger_api');
        expect(params.get('audience')).toBe('https://canton.network.global');
    });

    it('caches token and does not re-fetch within TTL', async () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        vi.mocked(fetch).mockResolvedValueOnce(mockTokenResponse('tok-cached', 3600));

        const provider = new ClientCredentialsTokenProvider({
            tokenUrl: TOKEN_URL,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        });

        const token1 = await provider.getToken();

        // Advance 30 minutes — within TTL (3600 - 60 buffer = 3540s)
        vi.advanceTimersByTime(30 * 60 * 1000);

        const token2 = await provider.getToken();
        expect(token2).toBe(token1);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('re-fetches after token expires past buffer', async () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        vi.mocked(fetch)
            .mockResolvedValueOnce(mockTokenResponse('tok-first', 300))
            .mockResolvedValueOnce(mockTokenResponse('tok-second', 300));

        const provider = new ClientCredentialsTokenProvider({
            tokenUrl: TOKEN_URL,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            bufferSeconds: 60,
        });

        const token1 = await provider.getToken();
        expect(token1).toBe('tok-first');

        // Advance past buffer (300 - 60 = 240s)
        vi.advanceTimersByTime(241 * 1000);

        const token2 = await provider.getToken();
        expect(token2).toBe('tok-second');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent getToken calls into a single fetch', async () => {
        let resolveToken: (v: Response) => void;
        const pendingFetch = new Promise<Response>((resolve) => {
            resolveToken = resolve;
        });
        vi.mocked(fetch).mockReturnValueOnce(pendingFetch);

        const provider = new ClientCredentialsTokenProvider({
            tokenUrl: TOKEN_URL,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        });

        // Fire 5 concurrent calls
        const promises = Array.from({ length: 5 }, () => provider.getToken());

        // Resolve the single fetch
        resolveToken!(mockTokenResponse('tok-coalesced', 3600));

        const tokens = await Promise.all(promises);
        expect(tokens).toEqual(Array(5).fill('tok-coalesced'));
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('throws on non-200 response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
            mockErrorResponse(401, 'invalid_client: bad credentials'),
        );

        const provider = new ClientCredentialsTokenProvider({
            tokenUrl: TOKEN_URL,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        });

        await expect(provider.getToken()).rejects.toThrow(
            /Client credentials token request failed: 401.*bad credentials/,
        );
    });

    it('retries fetch after a previous failure', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(mockErrorResponse(500, 'server error'))
            .mockResolvedValueOnce(mockTokenResponse('tok-retry', 3600));

        const provider = new ClientCredentialsTokenProvider({
            tokenUrl: TOKEN_URL,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
        });

        await expect(provider.getToken()).rejects.toThrow(/500/);

        // Second attempt should succeed (pending promise was cleared)
        const token = await provider.getToken();
        expect(token).toBe('tok-retry');
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
