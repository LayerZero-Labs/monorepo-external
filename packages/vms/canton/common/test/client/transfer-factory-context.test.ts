import { afterEach, describe, expect, it, vi } from 'vitest';

import { CantonClient } from '../../src/client/canton-client';
import { Configuration } from '../../src/open-api/runtime';
import { fetchTransferFactoryContext } from '../../src/refresh/registry-context';

afterEach(() => vi.unstubAllGlobals());
const args = {
    instrumentId: { admin: 'dso', id: 'Amulet' },
    sender: 'onesig-admin',
    receiver: 'actual-receiver',
    amount: '4.125',
    inputHoldingCids: ['holding-1', 'holding-2'],
    requestedAt: '2026-12-31T23:59:59.999999Z',
    executeBefore: '2027-01-01T00:00:00.000001Z',
};
const disclosure = {
    templateId: 'pkg:Factory:Factory',
    contractId: 'factory',
    createdEventBlob: 'blob',
    synchronizerId: 'sync',
};
const response = {
    factoryId: 'factory',
    choiceContext: {
        choiceContextData: { values: { opaque: { tag: 'AV_Text', value: 'actual-transfer' } } },
        disclosedContracts: [disclosure],
    },
};
const wallet = () =>
    new CantonClient(new Configuration(), 'user', {
        walletUrl: 'https://configured-wallet.example',
        tokenProvider: { getToken: async () => 'secret-wallet-token' },
    });
describe('actual transfer-factory context transport', () => {
    it('authenticates real transfer arguments against only the configured Wallet', async () => {
        const fetch = vi.fn(
            async () =>
                new Response(JSON.stringify(response), {
                    headers: { 'content-type': 'application/json' },
                }),
        );
        vi.stubGlobal('fetch', fetch);
        const result = await wallet().getAmuletTransferFactoryContext(args);
        expect(result).toEqual({
            factoryId: 'factory',
            choiceContext: response.choiceContext.choiceContextData,
            disclosedContracts: [disclosure],
        });
        const [url, options] = fetch.mock.calls[0] as unknown as [
            string,
            { headers: Record<string, string>; redirect: string; signal: unknown; body: string },
        ];
        expect(url).toBe(
            'https://configured-wallet.example/api/validator/v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory',
        );
        expect(options.headers).toMatchObject({ Authorization: 'Bearer secret-wallet-token' });
        expect(options.redirect).toBe('error');
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.parse(String(options.body))).toEqual({
            choiceArguments: {
                expectedAdmin: 'dso',
                transfer: { ...args, meta: { values: {} } },
                extraArgs: { context: { values: {} }, meta: { values: {} } },
            },
        });
    });
    it('accepts factory disclosures without optional templateId', async () => {
        const withoutTemplate = { ...disclosure };
        Reflect.deleteProperty(withoutTemplate, 'templateId');
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            ...response,
                            choiceContext: {
                                ...response.choiceContext,
                                disclosedContracts: [withoutTemplate],
                            },
                        }),
                        { headers: { 'content-type': 'application/json' } },
                    ),
            ),
        );
        expect((await wallet().getAmuletTransferFactoryContext(args)).disclosedContracts).toEqual([
            withoutTemplate,
        ]);
    });

    it('requires Wallet configuration', async () => {
        await expect(
            new CantonClient(new Configuration()).getAmuletTransferFactoryContext(args),
        ).rejects.toThrow('no wallet config');
    });
    it.each([
        { body: '{}', status: 200, contentType: 'application/json', error: 'schema validation' },
        { body: '{', status: 200, contentType: 'application/json', error: 'not valid JSON' },
        {
            body: JSON.stringify(response),
            status: 200,
            contentType: 'text/plain',
            error: 'application/json',
        },
        { body: 'denied', status: 403, contentType: 'text/plain', error: 'HTTP 403' },
        {
            body: JSON.stringify({
                ...response,
                choiceContext: { choiceContextData: { values: [] } },
            }),
            status: 200,
            contentType: 'application/json',
            error: 'schema validation',
        },
        {
            body: JSON.stringify({
                ...response,
                choiceContext: { disclosedContracts: [{ ...disclosure, createdEventBlob: '' }] },
            }),
            status: 200,
            contentType: 'application/json',
            error: 'schema validation',
        },
        {
            body: 'x'.repeat(256 * 1024 + 1),
            status: 200,
            contentType: 'application/json',
            error: 'exceeds',
        },
    ])(
        'rejects malformed/failed responses: $error',
        async ({ body, status, contentType, error }) => {
            vi.stubGlobal(
                'fetch',
                vi.fn(
                    async () =>
                        new Response(body, { status, headers: { 'content-type': contentType } }),
                ),
            );
            await expect(wallet().getAmuletTransferFactoryContext(args)).rejects.toThrow(error);
        },
    );
    it('keeps explicit public probe times and never sends Wallet authentication', async () => {
        const fetch = vi.fn(
            async () =>
                new Response(JSON.stringify(response), {
                    headers: { 'content-type': 'application/json' },
                }),
        );
        vi.stubGlobal('fetch', fetch);
        await fetchTransferFactoryContext('https://registry.example/base', args.instrumentId, args);
        const [url, options] = fetch.mock.calls[0] as unknown as [
            string,
            { headers: Record<string, string>; redirect: string; signal: unknown; body: string },
        ];
        expect(url).toBe(
            'https://registry.example/base/registry/transfer-instruction/v1/transfer-factory',
        );
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(String(options.body)).choiceArguments.transfer).toEqual({
            ...args,
            meta: { values: {} },
        });
    });
});
