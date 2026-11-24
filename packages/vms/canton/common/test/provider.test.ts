import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CantonGrpcClientOptions } from '../src/client/topology/types';

const { grpcClientOptions } = vi.hoisted(() => ({
    grpcClientOptions: [] as CantonGrpcClientOptions[],
}));

vi.mock('../src/auth/client-credentials-token-provider', () => ({
    ClientCredentialsTokenProvider: class {},
}));
vi.mock('../src/auth/local-token-provider', () => ({
    LocalTokenProvider: class {},
}));
vi.mock('../src/client/canton-client', () => ({
    CantonClient: class {},
}));
vi.mock('../src/client/grpc', () => ({
    CantonGrpcClient: class {
        constructor(options: CantonGrpcClientOptions) {
            grpcClientOptions.push(options);
        }
    },
}));
vi.mock('../src/open-api/runtime', () => ({ Configuration: class {} }));

const BASE = 'http://localhost:2975?admin-api=localhost:2902&wallet-url=http://localhost:2903';

const loadProvider = async () => import('../src/provider');

describe('parseCantonChainUri', () => {
    it('parses ledger, admin, wallet and user params', async () => {
        const { parseCantonChainUri } = await loadProvider();
        const params = parseCantonChainUri(`${BASE}&user-id=alice`);
        expect(params.jsonApiUrl).toBe('http://localhost:2975');
        expect(params.adminApiHost).toBe('localhost:2902');
        expect(params.walletUrl).toBe('http://localhost:2903');
        expect(params.userId).toBe('alice');
    });

    it('defaults userId to participant_admin', async () => {
        const { parseCantonChainUri } = await loadProvider();
        const params = parseCantonChainUri(BASE);
        expect(params.userId).toBe('participant_admin');
    });

    it('throws when admin-api is missing', async () => {
        const { parseCantonChainUri } = await loadProvider();
        expect(() =>
            parseCantonChainUri('http://localhost:2975?wallet-url=http://localhost:2903'),
        ).toThrow(/missing required "admin-api"/);
    });

    it('throws when wallet-url is missing', async () => {
        const { parseCantonChainUri } = await loadProvider();
        expect(() => parseCantonChainUri('http://localhost:2975?admin-api=localhost:2902')).toThrow(
            /missing required "wallet-url"/,
        );
    });

    it('strips canton params from jsonApiUrl but preserves unknown ones', async () => {
        const { parseCantonChainUri } = await loadProvider();
        const params = parseCantonChainUri(`${BASE}&foo=bar`);
        expect(params.jsonApiUrl).toBe('http://localhost:2975/?foo=bar');
    });

    it('strips legacy VER params from a combined RPC URI', async () => {
        const { parseCantonChainUri } = await loadProvider();
        const params = parseCantonChainUri(
            `${BASE}&sequencer-url=http://localhost:2904&sequencer-validators=0x04ab&sequencer-quorum=1`,
        );
        expect(params.jsonApiUrl).toBe('http://localhost:2975');
    });

    it('extracts oauth2 credentials when present', async () => {
        const { parseCantonChainUri } = await loadProvider();
        const params = parseCantonChainUri(
            `${BASE}&token-url=http://token&client-id=cid&client-secret=secret`,
        );
        expect(params.oauth2).toEqual({
            tokenUrl: 'http://token',
            clientId: 'cid',
            clientSecret: 'secret',
            scope: undefined,
            audience: undefined,
        });
    });

    it('falls back to CANTON_CLIENT_SECRET when URI omits client-secret', async () => {
        const previous = process.env.CANTON_CLIENT_SECRET;
        process.env.CANTON_CLIENT_SECRET = 'from-env';
        try {
            const { parseCantonChainUri } = await loadProvider();
            const params = parseCantonChainUri(`${BASE}&token-url=http://token&client-id=cid`);
            expect(params.oauth2).toEqual({
                tokenUrl: 'http://token',
                clientId: 'cid',
                clientSecret: 'from-env',
                scope: undefined,
                audience: undefined,
            });
        } finally {
            if (previous === undefined) {
                delete process.env.CANTON_CLIENT_SECRET;
            } else {
                process.env.CANTON_CLIENT_SECRET = previous;
            }
        }
    });
});

describe('createCantonChainProvider', () => {
    beforeEach(() => {
        grpcClientOptions.length = 0;
    });

    it('leaves the admin channel encrypted for a non-local deployment', async () => {
        const { createCantonChainProvider } = await loadProvider();

        createCantonChainProvider({
            uri: `${BASE}&token-url=http://token&client-id=cid&client-secret=secret`,
            isLocal: false,
        });

        expect(grpcClientOptions[0]?.insecureTransport).toBe(false);
    });

    it('drops admin channel encryption for a local deployment', async () => {
        const { createCantonChainProvider } = await loadProvider();

        createCantonChainProvider({ uri: BASE, isLocal: true });

        expect(grpcClientOptions[0]?.insecureTransport).toBe(true);
    });
});
