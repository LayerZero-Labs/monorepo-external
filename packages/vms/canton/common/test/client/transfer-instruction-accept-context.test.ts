import { afterEach, describe, expect, it, vi } from 'vitest';

import { CantonClient } from '../../src/client/canton-client';
import { Configuration } from '../../src/open-api/runtime';

const disclosedContracts = [
    { contractId: 'round', createdEventBlob: 'blob', synchronizerId: 'sync' },
];
const values = { round: { tag: 'AV_ContractId', value: 'round' } };

afterEach(() => vi.unstubAllGlobals());

describe('CantonClient transfer-instruction accept context', () => {
    it.each([
        { choiceContext: { choiceContextData: { values }, disclosedContracts } },
        { choiceContextData: { values }, disclosedContracts },
        { choiceContextData: values, disclosedContracts },
    ])(
        'preserves accept endpoint normalization and obtains a fresh token for each read',
        async (response) => {
            const fetch = vi.fn(
                async () => new Response(JSON.stringify(response), { status: 200 }),
            );
            vi.stubGlobal('fetch', fetch);
            const getToken = vi
                .fn()
                .mockResolvedValueOnce('first-token')
                .mockResolvedValueOnce('second-token');
            const client = new CantonClient(new Configuration(), 'user', {
                walletUrl: 'https://wallet.example/',
                tokenProvider: { getToken },
            });
            for (const token of ['first-token', 'second-token']) {
                await expect(
                    client.getTransferInstructionAcceptContext({ contractId: 'instruction/1' }),
                ).resolves.toEqual({ choiceContext: { values }, disclosedContracts });
                expect(fetch).toHaveBeenLastCalledWith(
                    new URL(
                        'https://wallet.example/api/validator/v0/scan-proxy/registry/transfer-instruction/v1/instruction%2F1/choice-contexts/accept',
                    ),
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ excludeDebugFields: true }),
                    },
                );
            }
            expect(getToken).toHaveBeenCalledTimes(2);
        },
    );

    it('requires wallet configuration before making a request', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const client = new CantonClient(new Configuration());
        await expect(
            client.getTransferInstructionAcceptContext({ contractId: 'instruction' }),
        ).rejects.toThrow('no wallet config');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('propagates the provider error without retrying', async () => {
        const fetch = vi.fn(async () => new Response('instruction expired', { status: 410 }));
        vi.stubGlobal('fetch', fetch);
        const client = new CantonClient(new Configuration(), 'user', {
            walletUrl: 'https://wallet.example/',
            tokenProvider: { getToken: async () => 'token' },
        });
        await expect(
            client.getTransferInstructionAcceptContext({ contractId: 'instruction' }),
        ).rejects.toThrow('Failed to get accept context: 410 instruction expired');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('CantonClient instruction lifecycle Wallet transport', () => {
    it.each(['accept', 'reject', 'withdraw'] as const)(
        'authenticates %s against configured Wallet only',
        async (choice) => {
            const fetch = vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({ choiceContextData: { values }, disclosedContracts }),
                    ),
            );
            vi.stubGlobal('fetch', fetch);
            const client = new CantonClient(new Configuration(), 'user', {
                walletUrl: 'https://wallet.example/',
                tokenProvider: { getToken: async () => 'secret' },
            });
            await expect(
                client.getTransferInstructionContext({ contractId: 'instruction/1', choice }),
            ).resolves.toEqual({ choiceContext: { values }, disclosedContracts });
            expect(fetch).toHaveBeenCalledWith(
                new URL(
                    `https://wallet.example/api/validator/v0/scan-proxy/registry/transfer-instruction/v1/instruction%2F1/choice-contexts/${choice}`,
                ),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ excludeDebugFields: true }),
                }),
            );
        },
    );
});
