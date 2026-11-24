import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    assertSafeRegistryUrl,
    discloseUtilityCredentials,
    discoveryUrlsForAppUid,
    fetchMergedTransferFactoryContext,
    fetchTransferInstructionRegistryContext,
    postFactoryContext,
} from '../../src/refresh/registry-context';
import type { CantonSdk } from '../../src/sdk';

const instrument = { admin: 'issuer', id: 'asset' };
const disclosure = (contractId: string, createdEventBlob = `blob-${contractId}`) => ({
    templateId: 'pkg:Module:Contract',
    contractId,
    createdEventBlob,
    synchronizerId: 'sync',
});
const list = (...ids: string[]) => ({
    tag: 'AV_List',
    value: ids.map((value) => ({ tag: 'AV_ContractId', value })),
});
const payload = (
    values: Record<string, unknown> = {},
    disclosures = [disclosure('factory')],
    factoryId = 'factory',
) => ({
    factoryId,
    choiceContext: { choiceContextData: { values }, disclosedContracts: disclosures },
});
const response = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const options = {
    sender: 'treasury',
    amount: '4.5',
    inputHoldingCids: ['holding'],
    receivers: ['bob', 'alice', 'bob'],
};
const probe = () =>
    fetchMergedTransferFactoryContext('https://registry.example/root', instrument, options);

afterEach(() => vi.unstubAllGlobals());

describe('registry transfer contexts', () => {
    it('probes actual sorted unique receivers and merges matching factory, list values and disclosures', async () => {
        const fetch = vi.fn(async (_url: string, init: globalThis.RequestInit) => {
            const receiver = JSON.parse(String(init.body)).choiceArguments.transfer.receiver;
            return response(
                payload({ credentials: list('shared', receiver), rule: 'same' }, [
                    disclosure('factory'),
                    disclosure(receiver),
                ]),
            );
        });
        vi.stubGlobal('fetch', fetch);
        const result = await probe();
        expect(result.choiceContext.values).toEqual({
            credentials: list('shared', 'alice', 'bob'),
            rule: 'same',
        });
        expect(result.disclosedContracts.map((entry) => entry.contractId)).toEqual([
            'factory',
            'alice',
            'bob',
        ]);
        expect(
            fetch.mock.calls.map(
                ([, init]) => JSON.parse(String(init.body)).choiceArguments.transfer.receiver,
            ),
        ).toEqual(['alice', 'bob']);
        for (const [url, init] of fetch.mock.calls) {
            expect(url).toBe(
                'https://registry.example/root/registry/transfer-instruction/v1/transfer-factory',
            );
            expect(init).toMatchObject({
                method: 'POST',
                redirect: 'error',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(init.signal).toBeInstanceOf(AbortSignal);
            const transfer = JSON.parse(String(init.body)).choiceArguments.transfer;
            expect(transfer).toMatchObject({
                sender: 'treasury',
                amount: '4.5',
                inputHoldingCids: ['holding'],
                instrumentId: instrument,
            });
            expect(Date.parse(transfer.executeBefore) - Date.parse(transfer.requestedAt)).toBe(
                3_600_000,
            );
        }
    });

    it.each(['factory', 'scalar', 'disclosure'] as const)(
        'rejects conflicting %s between receiver probes',
        async (conflict) => {
            const fetch = vi.fn().mockResolvedValueOnce(response(payload({ rule: 'a' })));
            fetch.mockResolvedValueOnce(
                response(
                    payload(
                        { rule: conflict === 'scalar' ? 'b' : 'a' },
                        [
                            disclosure(
                                'factory',
                                conflict === 'disclosure' ? 'changed' : 'blob-factory',
                            ),
                        ],
                        conflict === 'factory' ? 'other' : 'factory',
                    ),
                ),
            );
            vi.stubGlobal('fetch', fetch);
            await expect(probe()).rejects.toThrow(
                conflict === 'factory' ? 'factoryId mismatch' : 'conflicting',
            );
        },
    );

    it('rejects an empty receiver list before HTTP', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(
            fetchMergedTransferFactoryContext('https://registry.example', instrument, {
                ...options,
                receivers: [],
            }),
        ).rejects.toThrow('at least one receiver');
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['http://registry.example', undefined],
        ['http://evil.localhost', 'sandbox'],
        ['https://user:secret@registry.example', undefined],
        ['not-a-url', undefined],
    ])('retains rejected registry URL policy for %s', (url, environment) => {
        expect(() => assertSafeRegistryUrl(url!, { environment, label: 'registry' })).toThrow();
    });

    it('permits literal loopback HTTP only in sandbox', () => {
        expect(
            assertSafeRegistryUrl('http://127.0.0.1:8000', {
                environment: 'sandbox',
                label: 'registry',
            }).protocol,
        ).toBe('http:');
        expect(() =>
            assertSafeRegistryUrl('http://localhost', {
                environment: 'testnet',
                label: 'registry',
            }),
        ).toThrow('https');
    });

    it.each([
        [() => new Response('secret', { status: 500 }), 'HTTP 500'],
        [() => new Response('{}'), 'application/json'],
        [
            () => new Response('{', { headers: { 'content-type': 'application/json' } }),
            'not valid JSON',
        ],
        [
            () =>
                response({
                    factoryId: 'factory',
                    choiceContext: { disclosedContracts: [{ contractId: 'x' }] },
                }),
            'schema validation',
        ],
    ] as const)('rejects invalid provider response %#', async (makeResponse, message) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => makeResponse()),
        );
        await expect(
            postFactoryContext('https://registry.example', {}, { probeName: 'transfer-factory' }),
        ).rejects.toThrow(message);
    });

    it('bounds streamed bodies without trusting Content-Length', async () => {
        const cancel = vi.fn();
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(256 * 1024));
                controller.enqueue(new Uint8Array(1));
            },
            cancel,
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(stream, {
                        headers: { 'content-type': 'application/json', 'content-length': '1' },
                    }),
            ),
        );
        await expect(
            postFactoryContext('https://registry.example', {}, { probeName: 'transfer-factory' }),
        ).rejects.toThrow('exceeds 262144 bytes');
        expect(cancel).toHaveBeenCalled();
    });

    it('keeps the total abort deadline active through response body reads', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async (_url: string, init: globalThis.RequestInit) =>
                    new Response(
                        new ReadableStream({
                            start(controller) {
                                init.signal!.addEventListener('abort', () =>
                                    controller.error(init.signal!.reason),
                                );
                            },
                        }),
                        { headers: { 'content-type': 'application/json' } },
                    ),
            ),
        );
        await expect(
            postFactoryContext(
                'https://registry.example',
                {},
                { probeName: 'transfer-factory', timeoutMs: 5 },
            ),
        ).rejects.toThrow();
    });
});

describe('registry ledger dependencies', () => {
    it('accepts only handler-signed discovery entries and retains tuple/object maps', async () => {
        const registry = (handler: string, signatories: string[], urlMap: unknown) => ({
            createdEvent: { createArgument: { handler, urlMap }, signatories },
        });
        const sdk = {
            queryActiveContracts: vi.fn(async () => [
                registry('gateway', ['gateway'], [['app', 'https://a.example']]),
                registry('gateway', ['gateway'], { app: 'https://b.example' }),
                registry('gateway', ['other'], { app: 'https://fake.example' }),
                registry('other', ['other'], { app: 'https://foreign.example' }),
            ]),
        } as unknown as CantonSdk;
        await expect(discoveryUrlsForAppUid(sdk, 'gateway', 42, 'app')).resolves.toEqual([
            'https://a.example',
            'https://b.example',
        ]);
    });

    it('discloses sender credentials through the hosted holder after validating origin and template', async () => {
        const sdk = {
            fetchEventsByContractId: vi.fn(async () => ({
                created: {
                    templateId: 'pkg:Utility.Credential.V0.Credential:Credential',
                    createArgument: { holder: 'treasury' },
                    signatories: ['treasury'],
                },
            })),
            createDisclosure: vi.fn(async () => disclosure('credential')),
        };
        await expect(
            discloseUtilityCredentials(
                sdk as unknown as CantonSdk,
                list('credential'),
                'treasury',
                'sender',
            ),
        ).resolves.toEqual([disclosure('credential')]);
        expect(sdk.fetchEventsByContractId).toHaveBeenCalledWith('credential', ['treasury']);
        expect(sdk.createDisclosure).toHaveBeenCalledWith('credential', ['treasury']);
    });

    it.each(['missing', 'archived', 'template', 'holder', 'disclosure'] as const)(
        'rejects invalid credential %s',
        async (invalid) => {
            const created = {
                templateId:
                    invalid === 'template'
                        ? 'pkg:Other:Contract'
                        : 'pkg:Utility.Credential.V0.Credential:Credential',
                createArgument: { holder: invalid === 'holder' ? 'other' : 'treasury' },
                signatories: ['treasury'],
            };
            const sdk = {
                fetchEventsByContractId: vi.fn(async () => ({
                    created: invalid === 'missing' ? undefined : created,
                    archived: invalid === 'archived' ? {} : undefined,
                })),
                createDisclosure: vi.fn(async () =>
                    invalid === 'disclosure' ? undefined : disclosure('credential'),
                ),
            };
            await expect(
                discloseUtilityCredentials(
                    sdk as unknown as CantonSdk,
                    list('credential'),
                    'treasury',
                    'sender',
                ),
            ).rejects.toThrow();
        },
    );

    it('rejects more than eight credential IDs before ledger reads', async () => {
        const sdk = { fetchEventsByContractId: vi.fn() };
        await expect(
            discloseUtilityCredentials(
                sdk as unknown as CantonSdk,
                list(...Array.from({ length: 9 }, (_, index) => String(index))),
                'treasury',
                'sender',
            ),
        ).rejects.toThrow('exceeds 8 CIDs');
        expect(sdk.fetchEventsByContractId).not.toHaveBeenCalled();
    });
});

describe('instruction registry choice contexts', () => {
    it.each(['accept', 'reject', 'withdraw'] as const)(
        'uses top-level %s response and escaped CID without Wallet credentials',
        async (choice) => {
            const fetch = vi.fn(async () =>
                response({
                    choiceContextData: { values: { key: 'value' } },
                    disclosedContracts: [disclosure('provider')],
                }),
            );
            vi.stubGlobal('fetch', fetch);
            await expect(
                fetchTransferInstructionRegistryContext(
                    'https://registry.example/base/',
                    'a/b',
                    choice,
                ),
            ).resolves.toEqual({
                choiceContext: { values: { key: 'value' } },
                disclosedContracts: [disclosure('provider')],
            });
            expect(fetch).toHaveBeenCalledWith(
                `https://registry.example/base/registry/transfer-instruction/v1/a%2Fb/choice-contexts/${choice}`,
                expect.objectContaining({
                    headers: { 'Content-Type': 'application/json' },
                    redirect: 'error',
                }),
            );
        },
    );
    it('allows empty contexts but rejects malformed responses and unsafe URLs', async () => {
        const fetch = vi.fn(async () => response({}));
        vi.stubGlobal('fetch', fetch);
        await expect(
            fetchTransferInstructionRegistryContext(
                'http://localhost/',
                'cid',
                'accept',
                'sandbox',
            ),
        ).resolves.toEqual({ choiceContext: { values: {} }, disclosedContracts: [] });
        await expect(
            fetchTransferInstructionRegistryContext('http://localhost/', 'cid', 'accept'),
        ).rejects.toThrow('https');
        fetch.mockImplementation(async () => response({ choiceContextData: { values: [] } }));
        await expect(
            fetchTransferInstructionRegistryContext('https://registry.example/', 'cid', 'accept'),
        ).rejects.toThrow('schema');
    });
});
