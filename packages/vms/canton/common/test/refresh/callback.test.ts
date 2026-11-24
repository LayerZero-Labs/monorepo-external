import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ICantonClient } from '../../src/client/interface';
import { CantonSdk } from '../../src/sdk/canton-sdk';
import { cantonCallbackAppUid, resolveCantonFinalizeCallback } from '../../src/refresh/callback';
import {
    cantonRefreshPlanSchema,
    type CantonFinalizeCallbackRefresh,
} from '../../src/refresh/plan';
import { resolveCantonRefreshPlan } from '../../src/refresh/resolve-plan';
import type { CantonUnresolvedCommand } from '../../src/transaction';

const oappId = { admin: 'admin', id: 'token' };
const appUid = cantonCallbackAppUid(oappId.admin, oappId.id);
const fingerprint = 'f'.repeat(64);
const context = (fn: string, values: Record<string, unknown>) => [
    [
        'OApp',
        [
            [
                { tag: 'Addr_Text', value: appUid },
                [
                    [
                        'OApp',
                        [
                            [
                                { tag: 'Addr_Text', value: appUid },
                                [
                                    [
                                        fn,
                                        Object.entries(values).map(([key, value]) => [
                                            key,
                                            { tag: 'AV_Text', value },
                                        ]),
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
        ],
    ],
];

const fixture = (receive = false, accept = true, adapter = false) => {
    let version = '1';
    const pending = {
        handler: 'gateway',
        sender: 'sender',
        oappId,
        isAccept: accept,
        callbackContext: receive
            ? context('LzReceive_callback', { lzMessage: fingerprint + 'abcd' })
            : context('LzSend_callback', {
                  oftHoldingCid: 'locked',
                  payoutHoldingCid: 'payout',
                  rlScaledAmount: '1',
              }),
    };
    const config = {
        instrumentId: oappId,
        assetInstrumentId: { admin: 'issuer', id: 'asset' },
        localDecimals: '10',
        sharedDecimals: '6',
        rateLimiterConfig: { isGloballyDisabled: false, scaleDecimals: '6' },
    };
    const adapterState = {
        mintEscrow: 'escrow',
        treasury: 'treasury',
        kind: 'lock-unlock-adapter',
    };
    const event = (cid: string, templateId: string, payload: unknown, signer = 'admin') => ({
        contractId: cid,
        templateId,
        createArgument: payload,
        signatories: [signer],
        observers: [],
        createdEventBlob: `blob-${cid}`,
        packageName: templateId.slice(1, templateId.indexOf(':')),
    });
    const active = (
        cid: string,
        templateId: string,
        payload: unknown,
        interfaceId: string,
        view: unknown,
    ) => ({
        synchronizerId: 'sync',
        createdEvent: {
            ...event(cid, templateId, payload),
            interfaceViews: [
                { interfaceId: interfaceId.slice(1), viewValue: view, viewStatus: { code: 0 } },
            ],
        },
    });
    const disclosed = (cid: string) => ({
        contractId: cid,
        templateId: 'template',
        createdEventBlob: `blob-${cid}`,
        synchronizerId: 'sync',
    });
    const pendingEvent = event(
        'pending',
        '#layerzero-request:PendingCallback:PendingCallback',
        pending,
        'gateway',
    );
    const client = {
        getLedgerEndOffset: vi.fn(async () => 1),
        getPackageId: vi.fn(async (name: string) => name),
        queryActiveContracts: vi.fn(async () => [
            {
                createdEvent: event(
                    'discovery',
                    '#layerzero-discovery-registry:DiscoveryRegistry:DiscoveryRegistry',
                    {
                        handler: 'gateway',
                        urlMap: { [appUid]: `https://registry-${version}.example` },
                    },
                    'gateway',
                ),
                synchronizerId: 'sync',
            },
        ]),
        fetchEventsByContractId: vi.fn(async (cid: string) => ({
            created: cid === 'pending' ? pendingEvent : event(cid, 'holding', {}),
            archived: undefined,
        })),
        createDisclosure: vi.fn(async (cid: string) => disclosed(cid)),
        queryActiveContractsByInterface: vi.fn(
            async (_parties: string[], _offset: number, ids: string[]) => {
                const id = ids[0]!;
                if (id.includes(':IOApp:'))
                    return [
                        active(
                            `callback-${version}`,
                            adapter
                                ? adapterState.kind === 'lock-unlock-adapter'
                                    ? '#layerzero-lock-unlock-adapter:LockUnlockAdapter:LockUnlockAdapter'
                                    : adapterState.kind === 'burn-mint-adapter'
                                      ? '#layerzero-burn-mint-adapter:BurnMintAdapter:BurnMintAdapter'
                                      : '#layerzero-oft:OftSelf:OftSelf'
                                : '#layerzero-oft:OftSelf:OftSelf',
                            adapter
                                ? {
                                      oappId,
                                      treasury: adapterState.treasury,
                                      mintEscrow: adapterState.mintEscrow,
                                  }
                                : { instrumentId: oappId },
                            id,
                            { oappId, oappGateway: 'gateway' },
                        ),
                    ];
                if (id.includes(':IOAppConfig:'))
                    return [
                        active(
                            `config-${version}`,
                            adapter && adapterState.kind === 'lock-unlock-adapter'
                                ? '#layerzero-lock-unlock-adapter:AdapterConfig:AdapterConfig'
                                : adapter && adapterState.kind === 'burn-mint-adapter'
                                  ? '#layerzero-burn-mint-adapter:AdapterConfig:AdapterConfig'
                                  : '#layerzero-oft:OftSelfConfig:OftSelfConfig',
                            config,
                            id,
                            { oappId },
                        ),
                    ];
                if (id.includes(':Splice.Api.Token.HoldingV1:'))
                    return [
                        active(`holding-${version}`, '#asset:Holding:Holding', {}, id, {
                            owner:
                                adapterState.kind === 'burn-mint-adapter'
                                    ? adapterState.mintEscrow
                                    : 'treasury',
                            instrumentId: config.assetInstrumentId,
                            amount: '5',
                            lock: null,
                        }),
                    ];
                if (id.includes(':IRegistry:'))
                    return [
                        active(
                            `registry-${version}`,
                            '#layerzero-registry:Registry:Registry',
                            { oappId, fingerprintToHint: { [fingerprint]: 'recipient' } },
                            id,
                            { oappId },
                        ),
                    ];
                return [
                    active(
                        `limiter-${version}`,
                        '#layerzero-rate-limiter:RateLimiterState:RateLimiterState',
                        { oappId },
                        id,
                        { oappId },
                    ),
                ];
            },
        ),
    };
    const sdk = new CantonSdk(client as unknown as ICantonClient);
    return {
        sdk,
        client,
        pending,
        pendingEvent,
        config,
        adapterState,
        disclosed,
        rotate: () => {
            version = String(Number(version) + 1);
        },
    };
};
const input = { pendingCallbackCid: 'pending', informee: 'gateway' };
const command = (executeContext: unknown): CantonUnresolvedCommand => ({
    exerciseCommand: {
        templateId: '#layerzero-executor:Executor:Executor',
        contractId: 'executor',
        choice: 'FinalizeCallback',
        choiceArgument: {
            pendingCallbackCid: 'pending',
            callbackCid: 'callback-1',
            executeContext,
        },
    },
});
const entry = (
    identity: CantonFinalizeCallbackRefresh['resolver']['identity'],
): CantonFinalizeCallbackRefresh => ({
    resolver: { type: 'finalizeCallback', ...input, oappId, identity },
    targets: [
        {
            commandIndex: 0,
            command: 'exercise',
            choice: 'FinalizeCallback',
            arguments: [{ path: [{ field: 'executeContext' }] }],
        },
    ],
    callbackCidTargets: [
        {
            commandIndex: 0,
            command: 'exercise',
            choice: 'FinalizeCallback',
            arguments: [{ path: [{ field: 'callbackCid' }] }],
        },
    ],
});

describe('OftSelf callback refresh', () => {
    it.each([
        [false, false],
        [false, true],
        [true, false],
        [true, true],
    ])(
        'resolves receive=%s accept=%s with pinned holdings and conditional registry',
        async (receive, accept) => {
            const { sdk } = fixture(receive, accept);
            const result = await resolveCantonFinalizeCallback(sdk, input);
            const cids = result.disclosedContracts.map((value) => value.contractId);
            expect(cids.includes('registry-1')).toBe(receive && accept);
            expect(cids.includes('locked')).toBe(!receive);
            expect(cids.includes('payout')).toBe(!receive);
            expect(cids.includes('limiter-1')).toBe(!receive || accept);
            expect(result.identity).toEqual({
                kind: 'oft-self',
                instrumentId: oappId,
                localDecimals: '10',
                sharedDecimals: '6',
                rateLimiterScaleDecimals: '6',
            });
        },
    );

    it('replaces optional limiter context using fresh operational settings and retains frozen outbound usage', async () => {
        const f = fixture(true, true);
        f.config.rateLimiterConfig.isGloballyDisabled = true;
        const first = await resolveCantonFinalizeCallback(f.sdk, input);
        expect(JSON.stringify(first.executeContext)).not.toContain('rateLimiterStateCid');
        f.config.rateLimiterConfig.isGloballyDisabled = false;
        const second = await resolveCantonFinalizeCallback(f.sdk, {
            ...input,
            oappId,
            identity: first.identity,
        });
        expect(JSON.stringify(second.executeContext)).toContain('limiter-1');
        f.config.rateLimiterConfig.isGloballyDisabled = true;
        expect(
            JSON.stringify(
                (await resolveCantonFinalizeCallback(f.sdk, { ...input, identity: first.identity }))
                    .executeContext,
            ),
        ).not.toContain('rateLimiterStateCid');
        const outbound = fixture();
        outbound.config.rateLimiterConfig.isGloballyDisabled = true;
        expect(
            JSON.stringify(
                (await resolveCantonFinalizeCallback(outbound.sdk, input)).executeContext,
            ),
        ).toContain('limiter-1');
    });

    it.each(['localDecimals', 'sharedDecimals', 'scaleDecimals'])(
        'requires repopulation when %s changes',
        async (field) => {
            const f = fixture();
            const first = await resolveCantonFinalizeCallback(f.sdk, input);
            if (field === 'scaleDecimals') f.config.rateLimiterConfig.scaleDecimals = '5';
            else f.config[field as 'localDecimals' | 'sharedDecimals'] = '5';
            await expect(
                resolveCantonFinalizeCallback(f.sdk, { ...input, identity: first.identity }),
            ).rejects.toThrow('repopulate');
        },
    );

    it.each(['archived', 'template', 'handler', 'oapp', 'holding'])(
        'rejects invalid pinned callback/dependency: %s',
        async (failure) => {
            const f = fixture();
            if (failure === 'archived')
                f.client.fetchEventsByContractId.mockResolvedValue({
                    created: f.pendingEvent,
                    archived: {} as never,
                });
            if (failure === 'template') f.pendingEvent.templateId = '#other:Other:Other';
            if (failure === 'handler') f.pendingEvent.signatories = ['stranger'];
            if (failure === 'holding')
                f.client.fetchEventsByContractId.mockImplementation(async (cid) => ({
                    created: cid === 'locked' ? (undefined as never) : f.pendingEvent,
                    archived: undefined,
                }));
            await expect(
                resolveCantonFinalizeCallback(f.sdk, {
                    ...input,
                    oappId: failure === 'oapp' ? { ...oappId, id: 'other' } : oappId,
                }),
            ).rejects.toThrow();
        },
    );

    it('rejects missing or ambiguous dependencies and changed callback kind or instrument', async () => {
        for (const failure of ['missing', 'ambiguous', 'kind', 'instrument']) {
            const f = fixture();
            const original = f.client.queryActiveContractsByInterface.getMockImplementation()!;
            f.client.queryActiveContractsByInterface.mockImplementation(async (...args) => {
                const values = await original(...args);
                if (args[2][0]?.includes(':IOApp:')) {
                    if (failure === 'missing') return [];
                    if (failure === 'ambiguous') return [...values, ...values];
                    if (failure === 'kind')
                        values[0]!.createdEvent.templateId =
                            '#layerzero-lock-unlock-adapter:LockUnlockAdapter:LockUnlockAdapter';
                }
                return values;
            });
            if (failure === 'instrument') f.config.instrumentId = { ...oappId, id: 'different' };
            await expect(resolveCantonFinalizeCallback(f.sdk, input)).rejects.toThrow();
        }
    });

    it('rebuilds from original data, preserves disclosures and detects conflicts', async () => {
        const f = fixture(true, true);
        const initial = await resolveCantonFinalizeCallback(f.sdk, input);
        const plan = cantonRefreshPlanSchema.parse(
            JSON.parse(JSON.stringify({ commands: [entry(initial.identity)] })),
        );
        const baseline = [command(initial.executeContext)];
        const args = {
            unresolvedCommands: baseline,
            unresolvedDisclosedContracts: [
                ...initial.disclosedContracts,
                f.disclosed('original-unused'),
            ],
            refreshPlan: plan,
            signingParties: ['rich'],
            client: f.client as unknown as ICantonClient,
        };
        const before = structuredClone(baseline);
        f.rotate();
        const first = await resolveCantonRefreshPlan(args);
        f.rotate();
        const second = await resolveCantonRefreshPlan(args);
        expect(JSON.stringify(second.commands)).toContain('callback-3');
        expect(JSON.stringify(second.commands)).toContain('registry-3');
        expect(second.disclosedContracts.map((d) => d.contractId)).toEqual(
            expect.arrayContaining(['original-unused', 'callback-1', 'callback-3']),
        );
        expect(second.disclosedContracts.map((d) => d.contractId)).not.toContain('callback-2');
        expect(baseline).toEqual(before);
        const third = await resolveCantonRefreshPlan({
            ...args,
            unresolvedDisclosedContracts: [f.disclosed('original-unused')],
        });
        expect(third.disclosedContracts.map((d) => d.contractId)).not.toContain('callback-1');
        expect(first.commands).not.toEqual(second.commands);
        await expect(
            resolveCantonRefreshPlan({
                ...args,
                unresolvedDisclosedContracts: [
                    { ...f.disclosed('pending'), createdEventBlob: 'conflict' },
                ],
            }),
        ).rejects.toThrow('Conflicting disclosures');
    });

    it.each(['before', 'after'] as const)(
        'rejects a conflicting pending CID refresh declared %s callback resolution',
        async (order) => {
            const f = fixture();
            const initial = await resolveCantonFinalizeCallback(f.sdk, input);
            const original = command(initial.executeContext);
            const callback = entry(initial.identity);
            const conflicting = {
                resolver: {
                    type: 'activeContract',
                    selector: {
                        queryAs: { party: 'gateway' },
                        templateId: 'pkg:PendingCallback:PendingCallback',
                        expectedSignatories: ['gateway'],
                    },
                    selection: { kind: 'exactlyOne' },
                },
                targets: [
                    {
                        commandIndex: 0,
                        command: 'exercise',
                        choice: 'FinalizeCallback',
                        arguments: [{ path: [{ field: 'pendingCallbackCid' }] }],
                    },
                ],
            };
            Object.assign(f.client, {
                queryActiveContracts: vi.fn(async () => [
                    {
                        createdEvent: {
                            ...f.pendingEvent,
                            contractId: 'pending-other',
                            templateId: 'pkg:PendingCallback:PendingCallback',
                            createdEventBlob: 'blob-pending-other',
                        },
                        synchronizerId: 'sync',
                    },
                ]),
            });
            await expect(
                resolveCantonRefreshPlan({
                    unresolvedCommands: [original],
                    unresolvedDisclosedContracts: [],
                    refreshPlan: cantonRefreshPlanSchema.parse({
                        commands:
                            order === 'before' ? [conflicting, callback] : [callback, conflicting],
                    }),
                    signingParties: ['gateway'],
                    client: f.client as unknown as ICantonClient,
                }),
            ).rejects.toThrow('pinned PendingCallback');
            expect(original).toMatchObject({
                exerciseCommand: { choiceArgument: { pendingCallbackCid: 'pending' } },
            });
        },
    );

    it.each(['choice', 'path', 'pending', 'command'])(
        'guards %s before API reads',
        async (failure) => {
            const f = fixture();
            const initial = await resolveCantonFinalizeCallback(f.sdk, input);
            const original = command(initial.executeContext);
            const refresh = entry(initial.identity);
            if (failure === 'choice' && 'exerciseCommand' in original)
                original.exerciseCommand.choice = 'Other';
            if (failure === 'path')
                refresh.targets[0]!.arguments[0].path[0].field = 'pendingCallbackCid' as never;
            if (failure === 'pending' && 'exerciseCommand' in original)
                (
                    original.exerciseCommand.choiceArgument as Record<string, unknown>
                ).pendingCallbackCid = 'other';
            const commands =
                failure === 'command'
                    ? [{ createCommand: { templateId: 'x', createArguments: {} } }]
                    : [original];
            vi.clearAllMocks();
            await expect(
                resolveCantonRefreshPlan({
                    unresolvedCommands: commands,
                    unresolvedDisclosedContracts: [],
                    refreshPlan: { commands: [refresh] },
                    signingParties: ['rich'],
                    client: f.client as unknown as ICantonClient,
                }),
            ).rejects.toThrow();
            expect(f.client.fetchEventsByContractId).not.toHaveBeenCalled();
            expect(f.client.getLedgerEndOffset).not.toHaveBeenCalled();
        },
    );
});

afterEach(() => vi.unstubAllGlobals());

const mockRegistry = () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const transfer = JSON.parse(String(init.body)).choiceArguments.transfer;
        const version = new URL(_url).hostname;
        return new Response(
            JSON.stringify({
                factoryId: `factory-${version}`,
                choiceContext: {
                    choiceContextData: {
                        values: {
                            recipient: {
                                tag: 'AV_List',
                                value: [{ tag: 'AV_Text', value: transfer.receiver }],
                            },
                        },
                    },
                    disclosedContracts: [
                        {
                            contractId: `factory-${version}`,
                            templateId: 'asset:Factory:Factory',
                            createdEventBlob: `blob-${version}`,
                            synchronizerId: 'sync',
                        },
                    ],
                },
            }),
            { headers: { 'content-type': 'application/json' } },
        );
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
};

describe('lock/unlock callback refresh integration', () => {
    it.each([
        [
            false,
            true,
            { receiverCount: '2', receiver_0: 'alice', receiver_1: 'bob' },
            ['alice', 'bob'],
        ],
        [false, true, { receiverCount: '0' }, ['treasury']],
        [false, false, { receiverCount: '1', receiver_0: 'alice' }, ['sender']],
        [true, true, {}, [`recipient::1220${fingerprint}`]],
        [true, false, {}, []],
    ] as const)(
        'routes receive=%s accept=%s from pinned callback facts',
        async (receive, accept, payouts, receivers) => {
            const f = fixture(receive, accept, true);
            if (!receive) f.pending.callbackContext = context('LzSend_callback', payouts);
            const fetch = mockRegistry();
            const result = await resolveCantonFinalizeCallback(f.sdk, input);
            expect(result.identity).toMatchObject({
                kind: 'lock-unlock-adapter',
                treasury: 'treasury',
                instrumentId: { admin: 'issuer', id: 'asset' },
            });
            expect(
                fetch.mock.calls.map(
                    ([, init]) => JSON.parse(String(init.body)).choiceArguments.transfer.receiver,
                ),
            ).toEqual(receivers);
            expect(JSON.stringify(result.executeContext)).toContain('treasuryAssetCids');
            expect(JSON.stringify(result.executeContext).includes('transferFactoryCid')).toBe(
                receivers.length > 0,
            );
            expect(result.disclosedContracts.map((d) => d.contractId)).toContain('holding-1');
            expect(result.disclosedContracts.map((d) => d.contractId)).not.toContain('locked');
        },
    );

    it.each([
        'treasury',
        'instrument',
        'localDecimals',
        'sharedDecimals',
        'scaleDecimals',
        'kind',
    ] as const)('requires repopulation for changed %s before registry HTTP', async (field) => {
        const f = fixture(false, true, true);
        const fetch = mockRegistry();
        const initial = await resolveCantonFinalizeCallback(f.sdk, input);
        if (field === 'treasury') f.adapterState.treasury = 'other';
        else if (field === 'instrument')
            f.config.assetInstrumentId = { admin: 'other', id: 'asset' };
        else if (field === 'kind') f.adapterState.kind = 'oft-self';
        else if (field === 'scaleDecimals') f.config.rateLimiterConfig.scaleDecimals = '5';
        else f.config[field] = '5';
        fetch.mockClear();
        await expect(
            resolveCantonFinalizeCallback(f.sdk, { ...input, identity: initial.identity }),
        ).rejects.toThrow('repopulate');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rotates dependencies and operational settings from the original plan without accumulating attempts', async () => {
        const f = fixture(true, true, true);
        mockRegistry();
        f.config.rateLimiterConfig.isGloballyDisabled = true;
        const initial = await resolveCantonFinalizeCallback(f.sdk, input);
        const baseline = {
            unresolvedCommands: [command(initial.executeContext)],
            unresolvedDisclosedContracts: initial.disclosedContracts,
            refreshPlan: cantonRefreshPlanSchema.parse(
                JSON.parse(JSON.stringify({ commands: [entry(initial.identity)] })),
            ),
            signingParties: ['rich'],
            client: f.client as unknown as ICantonClient,
        };
        const original = structuredClone(baseline.unresolvedCommands);
        f.rotate();
        f.config.rateLimiterConfig.isGloballyDisabled = false;
        const first = await resolveCantonRefreshPlan(baseline);
        f.rotate();
        f.config.rateLimiterConfig.isGloballyDisabled = true;
        const second = await resolveCantonRefreshPlan(baseline);
        expect(JSON.stringify(first.commands)).toContain('limiter-2');
        expect(JSON.stringify(second.commands)).not.toContain('limiter-');
        expect(JSON.stringify(second.commands)).toContain('holding-3');
        expect(JSON.stringify(second.commands)).toContain('factory-registry-3.example');
        expect(second.disclosedContracts.map((d) => d.contractId)).toEqual(
            expect.arrayContaining([
                'holding-1',
                'holding-3',
                'factory-registry-1.example',
                'factory-registry-3.example',
            ]),
        );
        expect(second.disclosedContracts.map((d) => d.contractId)).not.toContain('holding-2');
        expect(baseline.unresolvedCommands).toEqual(original);
    });
});

const burnFixture = (receive = false, accept = true) => {
    const f = fixture(receive, accept, true);
    f.adapterState.kind = 'burn-mint-adapter';
    f.config.assetInstrumentId.admin = oappId.admin;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
        const mint = url.endsWith('burn-mint-factory');
        const version = new URL(url).hostname;
        const factoryId = `${mint ? 'mint' : 'transfer'}-${version}`;
        return new Response(
            JSON.stringify({
                factoryId,
                choiceContext: {
                    choiceContextData: {
                        values: { operation: { tag: 'AV_Text', value: factoryId } },
                    },
                    disclosedContracts: [f.disclosed(factoryId)],
                },
            }),
            { headers: { 'content-type': 'application/json' } },
        );
    });
    vi.stubGlobal('fetch', fetch);
    return { ...f, fetch };
};

describe('burn/mint callback refresh integration', () => {
    it.each([
        [
            false,
            true,
            { receiverCount: '2', receiver_0: 'alice', receiver_1: 'bob' },
            ['alice', 'bob'],
        ],
        [false, true, { receiverCount: '0' }, []],
        [false, false, { receiverCount: '0' }, ['sender']],
        [true, true, {}, [`recipient::1220${fingerprint}`]],
        [true, false, {}, []],
    ] as const)(
        'routes receive=%s accept=%s and keeps probe holdings out of funding',
        async (receive, accept, payouts, receivers) => {
            const f = burnFixture(receive, accept);
            if (!receive) f.pending.callbackContext = context('LzSend_callback', payouts);
            const result = await resolveCantonFinalizeCallback(f.sdk, input);
            expect(result.identity).toMatchObject({
                kind: 'burn-mint-adapter',
                mintEscrow: 'escrow',
            });
            const calls = f.fetch.mock.calls;
            expect(calls.filter(([url]) => url.endsWith('burn-mint-factory'))).toHaveLength(
                receivers.length ? 1 : 0,
            );
            expect(
                calls
                    .filter(([url]) => !url.endsWith('burn-mint-factory'))
                    .map(
                        ([, init]) =>
                            JSON.parse(String(init.body)).choiceArguments.transfer.receiver,
                    ),
            ).toEqual(receivers);
            const encoded = JSON.stringify(result.executeContext);
            expect(encoded.includes('burnMintFactoryCid')).toBe(receivers.length > 0);
            expect(encoded.includes('burnMintOutputContext')).toBe(receivers.length > 0);
            expect(encoded).not.toContain('treasuryAssetCids');
            expect(encoded).not.toContain('holding-1');
            expect(result.disclosedContracts.map((d) => d.contractId)).not.toContain('holding-1');
            if (receivers.length) expect(JSON.stringify(calls)).toContain('holding-1');
        },
    );

    it.each([
        'mintEscrow',
        'instrument',
        'localDecimals',
        'sharedDecimals',
        'scaleDecimals',
        'kind',
    ] as const)('requires repopulation when %s changes', async (field) => {
        const f = burnFixture();
        const initial = await resolveCantonFinalizeCallback(f.sdk, input);
        if (field === 'mintEscrow') f.adapterState.mintEscrow = 'other';
        else if (field === 'instrument') f.config.assetInstrumentId.id = 'other';
        else if (field === 'kind') f.adapterState.kind = 'lock-unlock-adapter';
        else if (field === 'scaleDecimals') f.config.rateLimiterConfig.scaleDecimals = '5';
        else f.config[field] = '5';
        f.fetch.mockClear();
        await expect(
            resolveCantonFinalizeCallback(f.sdk, { ...input, identity: initial.identity }),
        ).rejects.toThrow('repopulate');
        expect(f.fetch).not.toHaveBeenCalled();
    });

    it('rebuilds rotated mint and transfer context from the immutable baseline', async () => {
        const f = burnFixture(true);
        const initial = await resolveCantonFinalizeCallback(f.sdk, input);
        const baseline = {
            unresolvedCommands: [command(initial.executeContext)],
            unresolvedDisclosedContracts: initial.disclosedContracts,
            refreshPlan: cantonRefreshPlanSchema.parse(
                JSON.parse(JSON.stringify({ commands: [entry(initial.identity)] })),
            ),
            signingParties: ['rich'],
            client: f.client as unknown as ICantonClient,
        };
        const original = structuredClone(baseline.unresolvedCommands);
        f.rotate();
        const first = await resolveCantonRefreshPlan(baseline);
        f.rotate();
        const second = await resolveCantonRefreshPlan(baseline);
        expect(JSON.stringify(first.commands)).toContain('mint-registry-2.example');
        expect(JSON.stringify(second.commands)).toContain('mint-registry-3.example');
        expect(JSON.stringify(second.commands)).toContain('transfer-registry-3.example');
        expect(JSON.stringify(second.commands)).not.toContain('holding-');
        expect(second.disclosedContracts.map((d) => d.contractId)).toEqual(
            expect.arrayContaining([
                'mint-registry-1.example',
                'mint-registry-3.example',
                'transfer-registry-3.example',
            ]),
        );
        expect(second.disclosedContracts.map((d) => d.contractId)).not.toContain(
            'mint-registry-2.example',
        );
        expect(baseline.unresolvedCommands).toEqual(original);
    });
});
