import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JsActiveContract } from '../../src/open-api/models';
import { resolveBurnMintCallbackContext } from '../../src/refresh/callback-burn-mint';
import type { CantonSdk } from '../../src/sdk';

const instrumentId = { admin: 'issuer', id: 'asset' };
const HOLDING_INTERFACE = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
const disclosure = (cid: string) => ({
    contractId: cid,
    templateId: 'pkg:Factory:Factory',
    createdEventBlob: `blob-${cid}`,
    synchronizerId: 'sync',
});
const active = (
    cid: string,
    payload: unknown,
    signatories: string[] = ['issuer'],
): JsActiveContract =>
    ({
        createdEvent: {
            contractId: cid,
            templateId: 'pkg:BurnMintDelegate:BurnMintDelegate',
            createArgument: payload,
            signatories,
            createdEventBlob: `blob-${cid}`,
        },
        synchronizerId: 'sync',
    }) as JsActiveContract;
const delegate = (cid = 'delegate', factory = 'mint') =>
    active(cid, { instrumentId, delegate: 'adapter', burnMintFactoryCid: factory });
const holding = (cid: string, amount = '4'): JsActiveContract => ({
    ...active(cid, {}),
    createdEvent: {
        ...active(cid, {}).createdEvent,
        interfaceViews: [
            {
                interfaceId: HOLDING_INTERFACE,
                viewStatus: { code: 0, message: '' },
                viewValue: { owner: 'escrow', instrumentId, lock: null, amount },
            },
        ],
    },
});
const response = (
    factoryId: string,
    values: Record<string, unknown>,
    disclosures = [disclosure(factoryId)],
) =>
    new Response(
        JSON.stringify({
            factoryId,
            choiceContext: { choiceContextData: { values }, disclosedContracts: disclosures },
        }),
        { headers: { 'content-type': 'application/json' } },
    );
const credentialValue = (cid: string) => ({ tag: 'AV_ContractId', value: cid });

const setup = () => {
    const state = {
        delegates: [] as JsActiveContract[],
        mint: 'mint',
        transfer: 'transfer',
        url: 'https://registry.example/registrar/token',
        issuerCredential: 'issuer-credential',
        senderCredential: 'sender-credential',
    };
    const queryActiveContracts = vi.fn(
        async (_party: string, _offset: number, options: { templateIds?: string[] }) =>
            options.templateIds?.[0]?.includes('DiscoveryRegistry')
                ? [
                      active('discovery', { handler: 'gateway', urlMap: { app: state.url } }, [
                          'gateway',
                      ]),
                  ]
                : state.delegates,
    );
    const queryActiveContractsByInterface = vi.fn(async () => [holding('probe-holding')]);
    const fetchEventsByContractId = vi.fn(async (cid: string) => ({
        created: {
            ...active(cid, { holder: 'escrow' }, ['escrow']).createdEvent,
            templateId: 'pkg:Utility.Credential.V0.Credential:Credential',
        },
        archived: undefined,
    }));
    const createDisclosure = vi.fn(async (cid: string) => disclosure(cid));
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('burn-mint-factory'))
            return response(state.mint, {
                'utility.digitalasset.com/issuer-credentials': credentialValue(
                    state.issuerCredential,
                ),
            });
        const receiver = JSON.parse(String(init.body)).choiceArguments.transfer.receiver;
        return response(state.transfer, {
            'utility.digitalasset.com/sender-credentials': credentialValue(state.senderCredential),
            receivers: { tag: 'AV_List', value: [{ tag: 'AV_Text', value: receiver }] },
        });
    });
    vi.stubGlobal('fetch', fetch);
    const sdk = {
        queryActiveContracts,
        queryActiveContractsByInterface,
        fetchEventsByContractId,
        createDisclosure,
        getDsoParty: vi.fn(async () => 'dso'),
        getAmuletTransferFactoryContext: vi.fn(),
    } as unknown as CantonSdk;
    const resolve = (
        receivers = ['recipient'],
        oappAdmin = 'issuer',
        options: { environment?: string; instrumentId?: typeof instrumentId } = {},
    ) =>
        resolveBurnMintCallbackContext({
            sdk,
            informee: 'gateway',
            appUid: 'app',
            oappAdmin,
            mintEscrow: 'escrow',
            instrumentId: options.instrumentId ?? instrumentId,
            offset: 42,
            receivers,
            environment: options.environment,
        });
    return {
        state,
        sdk,
        fetch,
        resolve,
        queryActiveContracts,
        queryActiveContractsByInterface,
        fetchEventsByContractId,
        createDisclosure,
    };
};
afterEach(() => vi.unstubAllGlobals());

describe('burn/mint callback leaf', () => {
    it('uses origin mint probes and escrow holdings only as transfer probe inputs', async () => {
        const f = setup();
        f.queryActiveContractsByInterface.mockResolvedValue([
            holding('zero', '0'),
            holding('probe-a', '7'),
            holding('probe-b', '2'),
        ]);
        const result = await f.resolve();
        expect(f.fetch.mock.calls[0]![0]).toBe(
            'https://registry.example/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory',
        );
        expect(JSON.parse(String(f.fetch.mock.calls[0]![1].body))).toEqual({
            instrumentId,
            inputHoldingCids: [],
            outputs: [{ owner: 'escrow', amount: '1' }],
        });
        expect(f.fetch.mock.calls[1]![0]).toBe(
            'https://registry.example/registrar/token/registry/transfer-instruction/v1/transfer-factory',
        );
        expect(
            JSON.parse(String(f.fetch.mock.calls[1]![1].body)).choiceArguments.transfer,
        ).toMatchObject({
            sender: 'escrow',
            inputHoldingCids: ['probe-a', 'probe-b', 'zero'],
            amount: '7',
            receiver: 'recipient',
            instrumentId,
        });
        expect(result).toMatchObject({
            burnMintFactoryCid: 'mint',
            transferFactoryCid: 'transfer',
            burnMintOutputContext: {},
        });
        expect(result).not.toHaveProperty('treasuryAssetCids');
        expect(result.disclosedContracts.map((d) => d.contractId)).toEqual([
            'mint',
            'issuer-credential',
            'transfer',
            'sender-credential',
        ]);
        expect(f.fetchEventsByContractId).toHaveBeenCalledWith('issuer-credential', ['escrow']);
        expect(f.fetchEventsByContractId).toHaveBeenCalledWith('sender-credential', ['escrow']);
        expect(f.queryActiveContracts).toHaveBeenCalledWith('gateway', 42, expect.anything());
    });

    it('falls back to the DA Utilities origin and registrar when the OApp has no discovery URL', async () => {
        const f = setup();
        f.queryActiveContracts.mockImplementation(async (_party, _offset, options) =>
            options.templateIds?.[0]?.includes('DiscoveryRegistry') ? [] : f.state.delegates,
        );
        await f.resolve(['recipient'], 'issuer', { environment: 'mainnet' });
        expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
            'https://api.utilities.digitalasset.com/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory',
            'https://api.utilities.digitalasset.com/api/token-standard/v0/registrars/issuer/registry/transfer-instruction/v1/transfer-factory',
        ]);
    });

    it('retries both mint and transfer probes on DA Utilities when the discovery registry fails', async () => {
        const f = setup();
        const succeed = f.fetch.getMockImplementation()!;
        f.fetch.mockImplementation(async (url, init) =>
            new URL(url).origin === 'https://registry.example'
                ? new Response('down', { status: 503 })
                : succeed(url, init),
        );
        const result = await f.resolve(['recipient'], 'issuer', { environment: 'testnet' });
        expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
            'https://registry.example/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory',
            'https://api.utilities.digitalasset-staging.com/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory',
            'https://api.utilities.digitalasset-staging.com/api/token-standard/v0/registrars/issuer/registry/transfer-instruction/v1/transfer-factory',
        ]);
        expect(result).toMatchObject({
            burnMintFactoryCid: 'mint',
            transferFactoryCid: 'transfer',
        });
    });

    it('rejects canonical Amulet before any registry probe', async () => {
        const f = setup();
        await expect(
            f.resolve(['recipient'], 'dso', { instrumentId: { admin: 'dso', id: 'Amulet' } }),
        ).rejects.toThrow('Amulet cannot be minted through a burn-mint adapter');
        expect(f.fetch).not.toHaveBeenCalled();
    });

    it('caps escrow probe inputs at the largest holdings within the transfer input limit', async () => {
        const f = setup();
        f.queryActiveContractsByInterface.mockResolvedValue(
            Array.from({ length: 101 }, (_, index) =>
                holding(`probe-${String(index).padStart(3, '0')}`, `${index + 1}`),
            ),
        );
        await f.resolve();
        const transfer = JSON.parse(String(f.fetch.mock.calls[1]![1].body)).choiceArguments
            .transfer;
        expect(transfer.inputHoldingCids).toHaveLength(100);
        expect(transfer.inputHoldingCids[0]).toBe('probe-100');
        expect(transfer.inputHoldingCids).not.toContain('probe-000');
        expect(transfer.amount).toBe('101');
    });

    it('routes delegated mint through authenticated matching delegate while retaining real factory', async () => {
        const f = setup();
        const foreign = delegate('foreign');
        foreign.createdEvent.signatories = ['other'];
        f.state.delegates = [foreign, delegate()];
        const result = await f.resolve(['recipient'], 'adapter');
        expect(result.burnMintFactoryCid).toBe('delegate');
        expect(result.disclosedContracts.map((d) => d.contractId)).toEqual([
            'delegate',
            'mint',
            'issuer-credential',
            'transfer',
            'sender-credential',
        ]);
        expect(result.burnMintExtraArgs).toEqual({
            'utility.digitalasset.com/issuer-credentials': credentialValue('issuer-credential'),
        });
    });

    it.each(['missing', 'duplicate', 'mismatch', 'missing-blob'])(
        'fails %s delegate without transfer probing',
        async (failure) => {
            const f = setup();
            if (failure === 'duplicate') f.state.delegates = [delegate('one'), delegate('two')];
            if (failure === 'mismatch') f.state.delegates = [delegate('delegate', 'old-factory')];
            if (failure === 'missing-blob') {
                f.state.delegates = [delegate()];
                delete f.state.delegates[0]!.createdEvent.createdEventBlob;
            }
            await expect(f.resolve(['recipient'], 'adapter')).rejects.toThrow();
            expect(f.fetch).toHaveBeenCalledTimes(1);
        },
    );

    it('skips all reads and probes when the core supplies no receivers', async () => {
        const f = setup();
        await expect(f.resolve([], 'adapter')).resolves.toEqual({ disclosedContracts: [] });
        expect(f.fetch).not.toHaveBeenCalled();
        expect(f.queryActiveContracts).not.toHaveBeenCalled();
        expect(f.queryActiveContractsByInterface).not.toHaveBeenCalled();
    });

    it('deduplicates multiple receivers and merges each receiver context', async () => {
        const f = setup();
        const result = await f.resolve(['bob', 'alice', 'bob']);
        expect(f.fetch).toHaveBeenCalledTimes(3);
        expect(result.assetTransferContext?.receivers).toEqual({
            tag: 'AV_List',
            value: [
                { tag: 'AV_Text', value: 'alice' },
                { tag: 'AV_Text', value: 'bob' },
            ],
        });
        expect(result.disclosedContracts.filter((d) => d.contractId === 'transfer')).toHaveLength(
            1,
        );
    });

    it.each(['scalar', 'factory', 'disclosure'])(
        'propagates %s conflicts between receiver contexts',
        async (failure) => {
            const f = setup();
            f.fetch.mockImplementation(async (url, init) => {
                if (url.endsWith('burn-mint-factory')) return response('mint', {});
                const receiver = JSON.parse(String(init.body)).choiceArguments.transfer.receiver;
                const disclosures = [
                    {
                        ...disclosure('transfer'),
                        createdEventBlob: failure === 'disclosure' ? receiver : 'blob-transfer',
                    },
                ];
                return response(
                    failure === 'factory' ? receiver : 'transfer',
                    failure === 'scalar' ? { scalar: receiver } : {},
                    disclosures,
                );
            });
            await expect(f.resolve(['alice', 'bob'])).rejects.toThrow();
        },
    );

    it.each(['malformed', 'schema', 'provider'])(
        'propagates %s mint response failure',
        async (failure) => {
            const f = setup();
            f.fetch.mockResolvedValue(
                new Response(failure === 'malformed' ? '{' : '{}', {
                    status: failure === 'provider' ? 503 : 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );
            await expect(f.resolve()).rejects.toThrow();
            expect(f.fetch).toHaveBeenCalledTimes(1);
        },
    );

    it('preserves empty-holdings zero probe behavior and propagates transfer rejection', async () => {
        const f = setup();
        f.queryActiveContractsByInterface.mockResolvedValue([]);
        f.fetch.mockImplementation(async (url) =>
            url.endsWith('burn-mint-factory')
                ? response('mint', {})
                : new Response('rejected', { status: 400 }),
        );
        await expect(f.resolve()).rejects.toThrow('HTTP 400');
        expect(
            JSON.parse(String(f.fetch.mock.calls[1]![1].body)).choiceArguments.transfer,
        ).toMatchObject({ inputHoldingCids: [], amount: '0' });
    });

    it('fails when a required issuer credential is archived', async () => {
        const f = setup();
        f.fetchEventsByContractId.mockResolvedValue({
            created: active('issuer-credential', {}).createdEvent,
            archived: {} as never,
        });
        await expect(f.resolve()).rejects.toThrow('missing or archived');
        expect(f.fetch).toHaveBeenCalledTimes(1);
    });

    it('re-reads rotated factories, delegate, credentials and probe holdings', async () => {
        const f = setup();
        f.state.delegates = [delegate()];
        const first = await f.resolve(['recipient'], 'adapter');
        f.state.mint = 'mint-new';
        f.state.transfer = 'transfer-new';
        f.state.delegates = [delegate('delegate-new', 'mint-new')];
        f.state.issuerCredential = 'issuer-new';
        f.state.senderCredential = 'sender-new';
        f.queryActiveContractsByInterface.mockResolvedValue([holding('probe-new')]);
        const second = await f.resolve(['recipient'], 'adapter');
        expect(first.burnMintFactoryCid).toBe('delegate');
        expect(second.burnMintFactoryCid).toBe('delegate-new');
        expect(second.disclosedContracts.map((d) => d.contractId)).toEqual([
            'delegate-new',
            'mint-new',
            'issuer-new',
            'transfer-new',
            'sender-new',
        ]);
        expect(JSON.stringify(second)).not.toContain('probe-new');
        expect(
            JSON.parse(String(f.fetch.mock.calls[3]![1].body)).choiceArguments.transfer
                .inputHoldingCids,
        ).toEqual(['probe-new']);
    });
});
