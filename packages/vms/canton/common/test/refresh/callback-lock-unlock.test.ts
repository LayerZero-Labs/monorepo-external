import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InstrumentId } from '../../src/client/amulet';
import type { JsActiveContract } from '../../src/open-api/models';
import type { CantonSdk } from '../../src/sdk';
import { resolveLockUnlockCallbackContext } from '../../src/refresh/callback-lock-unlock';

const HOLDING_INTERFACE = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
const instrumentId = { admin: 'issuer', id: 'asset' };
const amuletId = { admin: 'dso', id: 'Amulet' };
const holding = (contractId: string, changes: Record<string, unknown> = {}): JsActiveContract =>
    ({
        createdEvent: {
            contractId,
            templateId: 'pkg:Asset:Holding',
            createdEventBlob: `blob-${contractId}`,
            interfaceViews: [
                {
                    interfaceId: HOLDING_INTERFACE,
                    viewStatus: { code: 0 },
                    viewValue: {
                        owner: 'treasury',
                        instrumentId,
                        amount: '4',
                        lock: null,
                        ...changes,
                    },
                },
            ],
        },
        synchronizerId: 'sync',
    }) as JsActiveContract;
const factoryContext = (receiver: string) => ({
    factoryId: 'factory',
    choiceContext: {
        values: { receivers: { tag: 'AV_List', value: [{ tag: 'AV_Text', value: receiver }] } },
    },
    disclosedContracts: [
        {
            contractId: 'factory',
            templateId: 'pkg:Factory:Factory',
            createdEventBlob: 'blob-factory',
            synchronizerId: 'sync',
        },
    ],
});
const discovery = (url: string) => ({
    createdEvent: {
        signatories: ['gateway'],
        createArgument: { handler: 'gateway', urlMap: { app: url } },
    },
});
const setup = () => {
    const queryActiveContractsByInterface = vi.fn(async () => [holding('holding-a')]);
    const queryActiveContracts = vi.fn(async () => [discovery('https://registry.example/root')]);
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const receiver = JSON.parse(String(init.body)).choiceArguments.transfer.receiver;
        return new Response(
            JSON.stringify({
                factoryId: 'factory',
                choiceContext: {
                    choiceContextData: {
                        values: {
                            receivers: {
                                tag: 'AV_List',
                                value: [{ tag: 'AV_Text', value: receiver }],
                            },
                        },
                    },
                    disclosedContracts: [
                        {
                            contractId: 'factory',
                            templateId: 'pkg:Factory:Factory',
                            createdEventBlob: 'blob-factory',
                            synchronizerId: 'sync',
                        },
                    ],
                },
            }),
            { headers: { 'content-type': 'application/json' } },
        );
    });
    vi.stubGlobal('fetch', fetch);
    const wallet = {
        getDsoParty: vi.fn(async () => 'dso'),
        getAmuletTransferFactoryContext: vi.fn(async ({ receiver }: { receiver: string }) =>
            factoryContext(receiver),
        ),
    };
    const sdk = {
        queryActiveContractsByInterface,
        queryActiveContracts,
        ...wallet,
    } as unknown as CantonSdk;
    const resolve = (
        receivers: string[],
        options: { instrumentId?: InstrumentId; environment?: string } = {},
    ) =>
        resolveLockUnlockCallbackContext({
            sdk,
            informee: 'gateway',
            appUid: 'app',
            treasury: 'treasury',
            instrumentId: options.instrumentId ?? instrumentId,
            offset: 42,
            receivers,
            environment: options.environment,
        });
    return { sdk, wallet, resolve, fetch, queryActiveContractsByInterface, queryActiveContracts };
};

afterEach(() => vi.unstubAllGlobals());

describe('lock/unlock callback leaf', () => {
    it('includes only unlocked treasury-owned matching-asset holdings and their disclosures', async () => {
        const { resolve, queryActiveContractsByInterface, fetch } = setup();
        queryActiveContractsByInterface.mockResolvedValue([
            holding('holding-zero', { amount: '0' }),
            holding('holding-a', { amount: '4.5' }),
            holding('holding-b'),
            holding('foreign', { owner: 'other' }),
            holding('locked', { lock: {} }),
            holding('wrong-asset', { instrumentId: { admin: 'issuer', id: 'other' } }),
            holding('wrong-issuer', { instrumentId: { admin: 'other', id: 'asset' } }),
        ]);
        const result = await resolve(['recipient']);
        expect(result.treasuryAssetCids).toEqual(['holding-a', 'holding-b', 'holding-zero']);
        expect(result.disclosedContracts.map((entry) => entry.contractId)).toEqual([
            'holding-a',
            'holding-b',
            'holding-zero',
            'factory',
        ]);
        expect(queryActiveContractsByInterface).toHaveBeenCalledWith(
            ['treasury'],
            42,
            [HOLDING_INTERFACE],
            { includeCreatedEventBlob: true },
        );
        const transfer = JSON.parse(String(fetch.mock.calls[0]![1].body)).choiceArguments.transfer;
        expect(transfer).toMatchObject({
            sender: 'treasury',
            receiver: 'recipient',
            inputHoldingCids: result.treasuryAssetCids,
            amount: '4.5',
        });
    });

    it('caps treasury inputs at the largest holdings within the transfer input limit', async () => {
        const { resolve, queryActiveContractsByInterface, fetch } = setup();
        queryActiveContractsByInterface.mockResolvedValue(
            Array.from({ length: 101 }, (_, index) =>
                holding(`holding-${String(index).padStart(3, '0')}`, { amount: `${index + 1}` }),
            ),
        );
        const result = await resolve(['recipient']);
        expect(result.treasuryAssetCids).toHaveLength(100);
        expect(result.treasuryAssetCids[0]).toBe('holding-100');
        expect(result.treasuryAssetCids).not.toContain('holding-000');
        expect(
            result.disclosedContracts.filter((entry) => entry.contractId.startsWith('holding-')),
        ).toHaveLength(100);
        const transfer = JSON.parse(String(fetch.mock.calls[0]![1].body)).choiceArguments.transfer;
        expect(transfer.inputHoldingCids).toEqual(result.treasuryAssetCids);
    });

    it.each([
        ['send acceptance payouts', ['alice', 'bob']],
        ['send acceptance zero-payout fallback', ['treasury']],
        ['send rejection refund', ['sender']],
        ['receive acceptance registry party', ['recipient']],
    ])('probes exactly the core-derived receivers for %s', async (_branch, receivers) => {
        const { resolve, fetch } = setup();
        const result = await resolve(receivers as string[]);
        expect(
            fetch.mock.calls.map(
                ([, init]) => JSON.parse(String(init.body)).choiceArguments.transfer.receiver,
            ),
        ).toEqual(receivers);
        expect(result.transferFactoryCid).toBe('factory');
    });

    it('retains holdings but skips discovery and HTTP on receive rejection', async () => {
        const { resolve, queryActiveContracts, fetch } = setup();
        await expect(resolve([])).resolves.toMatchObject({ treasuryAssetCids: ['holding-a'] });
        expect(queryActiveContracts).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('preserves empty holding/zero probes and propagates provider rejection', async () => {
        const { resolve, queryActiveContractsByInterface, fetch } = setup();
        queryActiveContractsByInterface.mockResolvedValue([]);
        fetch.mockResolvedValue(new Response('rejected', { status: 400 }));
        await expect(resolve(['recipient'])).rejects.toThrow('HTTP 400');
        const transfer = JSON.parse(String(fetch.mock.calls[0]![1].body)).choiceArguments.transfer;
        expect(transfer).toMatchObject({ inputHoldingCids: [], amount: '0', sender: 'treasury' });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('falls through ambiguous discovery URLs to the DA Utilities registrar', async () => {
        const { resolve, queryActiveContracts, fetch } = setup();
        queryActiveContracts.mockResolvedValue([
            discovery('https://registry.example'),
            discovery('https://registry.example'),
        ]);
        await resolve(['recipient'], { environment: 'testnet' });
        expect(fetch.mock.calls.map(([url]) => url)).toEqual([
            'https://api.utilities.digitalasset-staging.com/api/token-standard/v0/registrars/issuer/registry/transfer-instruction/v1/transfer-factory',
        ]);
        queryActiveContracts.mockResolvedValue([
            discovery('https://registry.example'),
            discovery('https://registry.example'),
        ]);
        await expect(resolve(['recipient'])).rejects.toThrow(
            'discovery-registry: expected one discovery URL, found 2',
        );
    });

    it('falls back to the DA Utilities registrar when the discovery registry fails', async () => {
        const { resolve, fetch } = setup();
        const succeed = fetch.getMockImplementation()!;
        fetch.mockResolvedValueOnce(new Response('down', { status: 503 }));
        fetch.mockImplementation(succeed);
        const result = await resolve(['recipient'], { environment: 'mainnet' });
        expect(fetch.mock.calls.map(([url]) => url)).toEqual([
            'https://registry.example/root/registry/transfer-instruction/v1/transfer-factory',
            'https://api.utilities.digitalasset.com/api/token-standard/v0/registrars/issuer/registry/transfer-instruction/v1/transfer-factory',
        ]);
        expect(result.transferFactoryCid).toBe('factory');
    });

    it('reports every failed registry when all paths fail', async () => {
        const { resolve, fetch } = setup();
        fetch.mockImplementation(async () => new Response('down', { status: 503 }));
        const error = await resolve(['recipient'], { environment: 'testnet' }).catch(
            (caught: Error) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
            /^No registry for appUid app instrument issuer\/asset \(discovery-registry: .*HTTP 503; da-utilities: .*HTTP 503\)$/,
        );
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('rejects when no registry path applies', async () => {
        const { resolve, queryActiveContracts, fetch } = setup();
        queryActiveContracts.mockResolvedValue([]);
        await expect(resolve(['recipient'], { environment: 'sandbox' })).rejects.toThrow(
            'No registry for appUid app instrument issuer/asset',
        );
        expect(fetch).not.toHaveBeenCalled();
    });

    it('falls back to the DA Utilities registrar when the OApp has no discovery URL', async () => {
        const { resolve, queryActiveContracts, fetch, wallet } = setup();
        queryActiveContracts.mockResolvedValue([]);
        const result = await resolve(['recipient'], { environment: 'testnet' });
        expect(fetch.mock.calls[0]![0]).toBe(
            'https://api.utilities.digitalasset-staging.com/api/token-standard/v0/registrars/issuer/registry/transfer-instruction/v1/transfer-factory',
        );
        expect(result.transferFactoryCid).toBe('factory');
        expect(wallet.getDsoParty).not.toHaveBeenCalled();
    });

    it('prefers the discovery URL over the DA Utilities registrar', async () => {
        const { resolve, fetch } = setup();
        await resolve(['recipient'], { environment: 'mainnet' });
        expect(fetch.mock.calls[0]![0]).toBe(
            'https://registry.example/root/registry/transfer-instruction/v1/transfer-factory',
        );
    });

    it('probes the wallet for canonical Amulet without discovery or registry HTTP', async () => {
        const { resolve, queryActiveContractsByInterface, queryActiveContracts, fetch, wallet } =
            setup();
        queryActiveContractsByInterface.mockResolvedValue([
            holding('amulet-a', { instrumentId: amuletId, amount: '7' }),
        ]);
        const result = await resolve(['bob', 'alice'], {
            instrumentId: amuletId,
            environment: 'testnet',
        });
        expect(wallet.getAmuletTransferFactoryContext.mock.calls.map(([args]) => args)).toEqual([
            expect.objectContaining({
                instrumentId: amuletId,
                sender: 'treasury',
                receiver: 'alice',
                amount: '7',
                inputHoldingCids: ['amulet-a'],
            }),
            expect.objectContaining({ receiver: 'bob' }),
        ]);
        expect(result).toMatchObject({
            treasuryAssetCids: ['amulet-a'],
            transferFactoryCid: 'factory',
            assetTransferContext: {
                receivers: {
                    tag: 'AV_List',
                    value: [
                        { tag: 'AV_Text', value: 'alice' },
                        { tag: 'AV_Text', value: 'bob' },
                    ],
                },
            },
        });
        expect(queryActiveContracts).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not treat a non-DSO "Amulet" instrument as canonical', async () => {
        const { resolve, fetch, wallet } = setup();
        const fake = { admin: 'issuer', id: 'Amulet' };
        await resolve(['recipient'], { instrumentId: fake });
        expect(wallet.getDsoParty).toHaveBeenCalled();
        expect(wallet.getAmuletTransferFactoryContext).not.toHaveBeenCalled();
        expect(fetch.mock.calls[0]![0]).toBe(
            'https://registry.example/root/registry/transfer-instruction/v1/transfer-factory',
        );
    });

    it('re-reads rotated discovery and variable-count holdings without mutating prior results', async () => {
        const { resolve, queryActiveContractsByInterface, queryActiveContracts, fetch } = setup();
        const first = await resolve(['recipient']);
        queryActiveContractsByInterface.mockResolvedValue([holding('new-a'), holding('new-b')]);
        queryActiveContracts.mockResolvedValue([discovery('https://fresh.example/root')]);
        const second = await resolve(['recipient']);
        expect(first.treasuryAssetCids).toEqual(['holding-a']);
        expect(second.treasuryAssetCids).toEqual(['new-a', 'new-b']);
        expect(fetch.mock.calls[1]![0]).toBe(
            'https://fresh.example/root/registry/transfer-instruction/v1/transfer-factory',
        );
    });

    it('rejects missing holding disclosure blobs before probing', async () => {
        const { resolve, queryActiveContractsByInterface, fetch } = setup();
        const contract = holding('missing-blob');
        delete contract.createdEvent.createdEventBlob;
        queryActiveContractsByInterface.mockResolvedValue([contract]);
        await expect(resolve(['recipient'])).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
});
