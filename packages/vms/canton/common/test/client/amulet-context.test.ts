import { afterEach, describe, expect, it, vi } from 'vitest';

import { CantonClient } from '../../src/client/canton-client';
import { Configuration } from '../../src/open-api/runtime';

const instrumentId = { admin: 'dso', id: 'Amulet' };
const externalRules = {
    templateId: 'pkg:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules',
    contractId: 'external-rules',
    createdEventBlob: 'blob',
    synchronizerId: 'sync',
};

afterEach(() => vi.unstubAllGlobals());

describe('CantonClient amulet context', () => {
    const probeTransfer = async (
        ...args: Parameters<CantonClient['getAmuletContextWithExternalRules']>
    ) => {
        const fetch = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choiceContext: {
                            choiceContextData: { values: {} },
                            disclosedContracts: [externalRules],
                        },
                    }),
                ),
        );
        vi.stubGlobal('fetch', fetch);
        const client = new CantonClient(new Configuration(), 'user', {
            walletUrl: 'https://wallet.example',
            tokenProvider: { getToken: async () => 'token' },
        });

        const result = await client.getAmuletContextWithExternalRules(...args);

        expect(result.externalPartyAmuletRulesCid).toBe('external-rules');
        const [, options] = fetch.mock.calls[0] as unknown as [URL, { body: string }];
        return JSON.parse(options.body).choiceArguments.transfer;
    };

    it('probes a zero-amount admin self-transfer without options', async () => {
        expect(await probeTransfer(instrumentId)).toMatchObject({
            sender: 'dso',
            receiver: 'dso',
            amount: '0',
        });
    });

    it('forwards the receiver and amount to the probe', async () => {
        expect(
            await probeTransfer(instrumentId, { receiver: 'receiver', amount: '2.5' }),
        ).toMatchObject({ sender: 'dso', receiver: 'receiver', amount: '2.5' });
    });
});
