import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ICantonClient } from '../../src/client/interface';
import { cantonSenderPartyRef } from '../../src/deferredValue';
import type { JsActiveContract } from '../../src/open-api/models';
import { cantonCallbackAppUid } from '../../src/refresh/callback';
import { cantonRefreshPlanSchema } from '../../src/refresh/plan';
import { resolveCantonRefreshPlan } from '../../src/refresh/resolve-plan';

const cid = 'instruction/1';
const tags = ['OpAcceptTransferInstruction', 'OpWithdrawTransferInstruction'] as const;
const disclosure = (id: string) => ({
    contractId: id,
    templateId: 'pkg:Provider:State',
    createdEventBlob: `blob-${id}`,
    synchronizerId: 'sync',
});
const setup = (
    tag: (typeof tags)[number] = tags[0],
    instrumentId = { admin: 'issuer', id: 'TOKEN' },
) => {
    const signed = {
        transferSender: tag === tags[1] ? 'admin' : 'sender',
        receiver: 'admin',
        amount: '1.50',
        instrumentId,
        requestedAt: '2026-01-01T00:00:00.000001Z',
        executeBefore: '2026-01-01T01:00:00Z',
        transferMeta: { values: { memo: 'one', other: 'two' } },
        instructionMeta: { values: { instruction: 'fixed' } },
        extraArgsMeta: { values: { extra: 'signed' } },
    };
    const view = {
        transfer: {
            sender: signed.transferSender,
            receiver: signed.receiver,
            amount: '1.5000000000',
            instrumentId,
            requestedAt: signed.requestedAt,
            executeBefore: '2026-01-01T01:00:00.000000Z',
            meta: { values: { other: 'two', memo: 'one' } },
        },
        meta: signed.instructionMeta,
        status: { tag: 'TransferPendingReceiverAcceptance' },
    };
    const row = {
        createdEvent: {
            ...disclosure(cid),
            signatories: ['issuer'],
            interfaceViews: [
                {
                    interfaceId: 'pkg:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
                    viewValue: view,
                    viewStatus: { code: 0 },
                },
            ],
        },
        synchronizerId: 'sync',
    };
    const state = { instructions: [row], registries: [] as JsActiveContract[], revision: 'first' };
    const api = {
        getLedgerEndOffset: vi.fn(async () => 1),
        getPackageId: vi.fn(async () => 'pkg'),
        queryActiveContractsByInterface: vi.fn(
            async (_parties: string[], _offset: number, _interfaces: string[], _options: object) =>
                state.instructions,
        ),
        queryActiveContracts: vi.fn(async () => state.registries),
        getDsoParty: vi.fn(async () => 'issuer'),
        getTransferInstructionContext: vi.fn(async () => ({
            choiceContext: { values: { revision: state.revision } },
            disclosedContracts: [disclosure(state.revision)],
        })),
    };
    const fetch = vi.fn(
        async (_url: string, _options: globalThis.RequestInit) =>
            new Response(
                JSON.stringify({
                    choiceContextData: { values: { revision: state.revision } },
                    disclosedContracts: [disclosure(state.revision)],
                }),
                { headers: { 'content-type': 'application/json' } },
            ),
    );
    vi.stubGlobal('fetch', fetch);
    const context = {
        tag: 'TransferInstructionContext',
        value: { transferInstructionCid: cid, extraArgsContext: { values: { original: true } } },
    };
    const target = {
        commandIndex: 0,
        command: 'exercise',
        choice: 'OneSig_ExecuteTransaction',
        arguments: [
            {
                path: [
                    { field: 'transaction' },
                    { field: 'calls' },
                    { index: 0 },
                    { field: 'context' },
                ],
            },
        ],
    };
    const plan = {
        commands: [
            {
                resolver: {
                    type: 'oneSigTransferInstructionContext',
                    admin: 'admin',
                    informee: 'informee',
                    transferInstructionCid: cid,
                    registryUrls: { issuer: 'https://registry.example/' },
                },
                targets: [target],
            },
        ],
    };
    const argument = {
        executor: 'executor',
        merkleRoot: 'root',
        signatures: ['signature'],
        expiry: 'fixed',
        transaction: { proof: ['proof'], calls: [{ call: { tag, value: signed }, context }] },
    };
    const commands = [
        {
            exerciseCommand: {
                templateId: 'pkg:OneSig:OneSig',
                contractId: 'anchor',
                choice: 'OneSig_ExecuteTransaction',
                choiceArgument: argument,
            },
        },
    ];
    const resolve = async (refreshPlan: unknown = plan) =>
        resolveCantonRefreshPlan({
            unresolvedCommands: commands,
            unresolvedDisclosedContracts: [disclosure('original')],
            refreshPlan: cantonRefreshPlanSchema.parse(JSON.parse(JSON.stringify(refreshPlan))),
            senderParty: 'assigned',
            signingParties: ['executor'],
            client: api as unknown as ICantonClient,
        });
    return { signed, view, row, state, api, fetch, plan, argument, commands, context, resolve };
};
afterEach(() => vi.unstubAllGlobals());

describe('OneSig pinned instruction refresh', () => {
    it.each(tags)(
        'refreshes %s twice without changing signed data or accumulating prior context',
        async (tag) => {
            const f = setup(tag);
            const original = structuredClone(f.argument);
            for (const revision of ['first', 'second']) {
                f.state.revision = revision;
                const result = await f.resolve();
                const args = (result.commands[0] as (typeof f.commands)[number]).exerciseCommand
                    .choiceArgument;
                expect(args).toEqual({
                    ...original,
                    transaction: {
                        ...original.transaction,
                        calls: [
                            {
                                ...original.transaction.calls[0],
                                context: {
                                    tag: 'TransferInstructionContext',
                                    value: {
                                        transferInstructionCid: cid,
                                        extraArgsContext: { values: { revision } },
                                    },
                                },
                            },
                        ],
                    },
                });
                expect(result.disclosedContracts.map((d) => d.contractId)).toEqual([
                    'original',
                    cid,
                    revision,
                ]);
            }
            expect(f.argument).toEqual(original);
            expect(f.api.queryActiveContractsByInterface).toHaveBeenCalledWith(
                ['admin'],
                1,
                expect.any(Array),
                { includeCreatedEventBlob: true },
            );
            expect(f.api.getDsoParty).not.toHaveBeenCalled();
            expect(f.fetch.mock.calls[0]![0]).toContain(
                `/instruction%2F1/choice-contexts/${tag === tags[0] ? 'accept' : 'withdraw'}`,
            );
        },
    );

    it('rejects an equivalent replacement without contacting the provider', async () => {
        const f = setup();
        f.row.createdEvent.contractId = 'replacement';
        await expect(f.resolve()).rejects.toThrow('not active');
        expect(f.fetch).not.toHaveBeenCalled();
    });
    it.each(['amount', 'sender', 'receiver', 'requestedAt', 'executeBefore'] as const)(
        'rejects mismatching %s',
        async (field) => {
            const f = setup();
            f.view.transfer[field] =
                field.endsWith('At') || field === 'executeBefore'
                    ? '2026-01-01T00:00:00.000002Z'
                    : 'other';
            await expect(f.resolve()).rejects.toThrow();
            expect(f.fetch).not.toHaveBeenCalled();
        },
    );
    it.each(['transfer', 'instruction'])('rejects mismatching %s metadata', async (kind) => {
        const f = setup();
        if (kind === 'transfer') f.view.transfer.meta.values.memo = 'changed';
        else f.view.meta = { values: { instruction: 'changed' } };
        await expect(f.resolve()).rejects.toThrow('signed intent');
    });
    it('accepts equivalent timezone representation without losing microseconds', async () => {
        const f = setup();
        f.view.transfer.requestedAt = '2026-01-01T01:00:00.000001+01:00';
        await f.resolve();
    });
    it.each(tags)('enforces authority and applicable status for %s', async (tag) => {
        const f = setup(tag);
        f.view.status.tag = 'TransferPendingSenderAcceptance';
        if (tag === tags[1]) await f.resolve();
        else await expect(f.resolve()).rejects.toThrow('status');
        f.signed[tag === tags[1] ? 'transferSender' : 'receiver'] = 'other';
        await expect(f.resolve()).rejects.toThrow('authority');
    });
    it('rejects wrong signatory, failed interface view and missing blob before provider IO', async () => {
        const f = setup();
        f.row.createdEvent.signatories = [];
        await expect(f.resolve()).rejects.toThrow('signatory');
        f.row.createdEvent.signatories = ['issuer'];
        f.row.createdEvent.interfaceViews[0]!.viewStatus.code = 7;
        await expect(f.resolve()).rejects.toThrow('interface');
        f.row.createdEvent.interfaceViews[0]!.viewStatus.code = 0;
        f.row.createdEvent.createdEventBlob = '';
        await expect(f.resolve()).rejects.toThrow('Missing disclosure');
        expect(f.fetch).not.toHaveBeenCalled();
    });
    it.each(tags)('routes canonical Amulet %s to Wallet', async (tag) => {
        const f = setup(tag, { admin: 'issuer', id: 'Amulet' });
        await f.resolve();
        expect(f.api.getTransferInstructionContext).toHaveBeenCalledWith({
            contractId: cid,
            choice: tag === tags[0] ? 'accept' : 'withdraw',
        });
        expect(f.fetch).not.toHaveBeenCalled();
    });
    it('routes foreign Amulet through registry and rotates discovery ahead of fallback', async () => {
        const f = setup(tags[0], { admin: 'issuer', id: 'Amulet' });
        f.api.getDsoParty.mockResolvedValue('real-dso');
        const registry = (url: string): JsActiveContract =>
            ({
                createdEvent: {
                    templateId: 'pkg:DiscoveryRegistry:DiscoveryRegistry',
                    signatories: ['informee'],
                    createArgument: {
                        handler: 'informee',
                        urlMap: { [cantonCallbackAppUid('issuer', 'Amulet')]: url },
                    },
                },
            }) as JsActiveContract;
        for (const url of ['https://first.example/', 'https://second.example/']) {
            f.state.registries = [registry(url)];
            await f.resolve();
            expect(f.fetch.mock.calls.at(-1)![0]).toContain(url);
        }
        f.state.registries.push(registry('https://third.example/'));
        await expect(f.resolve()).rejects.toThrow('Ambiguous');
        expect(f.api.getTransferInstructionContext).not.toHaveBeenCalled();
    });
    it('rejects wrong nested context and pinned CID', async () => {
        const f = setup();
        f.context.tag = 'Other';
        await expect(f.resolve()).rejects.toThrow('target');
        f.context.tag = 'TransferInstructionContext';
        f.context.value.transferInstructionCid = 'other';
        await expect(f.resolve()).rejects.toThrow('pinned');
        expect(f.fetch).not.toHaveBeenCalled();
    });
    it('binds only executor and still reads instruction as admin', async () => {
        const f = setup();
        f.argument.executor = cantonSenderPartyRef();
        await f.resolve({
            ...f.plan,
            replaceSentinels: [
                {
                    kind: 'senderParty',
                    targets: [
                        {
                            commandIndex: 0,
                            command: 'exercise',
                            choice: 'OneSig_ExecuteTransaction',
                            arguments: [{ path: [{ field: 'executor' }] }],
                        },
                    ],
                },
            ],
        });
        expect(f.api.queryActiveContractsByInterface.mock.calls[0]![0]).toEqual(['admin']);
    });
    it('rejects malformed targets and unrelated signed calls before ledger/provider reads', async () => {
        const f = setup();
        await expect(
            f.resolve({ commands: [{ ...f.plan.commands[0], targets: [] }] }),
        ).rejects.toThrow();
        f.argument.transaction.calls[0]!.call.tag = 'OpSetThreshold' as (typeof tags)[number];
        await expect(f.resolve()).rejects.toThrow();
        expect(f.api.queryActiveContractsByInterface).not.toHaveBeenCalled();
        expect(f.fetch).not.toHaveBeenCalled();
    });
    it('rejects Reject calls, which OneSig aborts on-ledger, before ledger/provider reads', async () => {
        const f = setup(tags[0]);
        f.argument.transaction.calls[0]!.call.tag =
            'OpRejectTransferInstruction' as (typeof tags)[number];
        await expect(f.resolve()).rejects.toThrow('OpRejectTransferInstruction is not supported');
        expect(f.api.queryActiveContractsByInterface).not.toHaveBeenCalled();
        expect(f.fetch).not.toHaveBeenCalled();
    });
    it('rejects conflicting provider disclosure and does not mutate original commands', async () => {
        const f = setup();
        const original = structuredClone(f.commands);
        f.fetch.mockImplementation(
            async () =>
                new Response(
                    JSON.stringify({
                        disclosedContracts: [
                            { ...disclosure('original'), createdEventBlob: 'conflict' },
                        ],
                    }),
                    { headers: { 'content-type': 'application/json' } },
                ),
        );
        await expect(f.resolve()).rejects.toThrow(/conflict/i);
        expect(f.commands).toEqual(original);
    });
    it('fails absent registry and invalid instruction instrument rather than switching intent', async () => {
        const f = setup();
        delete (f.plan.commands[0]!.resolver.registryUrls as Record<string, string>).issuer;
        await expect(f.resolve()).rejects.toThrow('No registry');
        f.view.transfer.instrumentId = { admin: 'wrong', id: 'TOKEN' };
        await expect(f.resolve()).rejects.toThrow('signed intent');
    });
    it.each(tags)('rejects malformed new-CID Wallet disclosures for %s', async (tag) => {
        const f = setup(tag, { admin: 'issuer', id: 'Amulet' });
        for (const field of ['createdEventBlob', 'contractId', 'synchronizerId'] as const) {
            for (const value of [undefined, '']) {
                const malformed = { ...disclosure('new-provider-cid'), [field]: value };
                f.api.getTransferInstructionContext.mockResolvedValue({
                    choiceContext: { values: { revision: 'valid' } },
                    disclosedContracts: [malformed as ReturnType<typeof disclosure>],
                });
                await expect(f.resolve()).rejects.toThrow();
            }
        }
        f.api.getTransferInstructionContext.mockResolvedValue({
            choiceContext: { values: { revision: 'valid' } },
            disclosedContracts: [disclosure('new-provider-cid')],
        });
        expect((await f.resolve()).disclosedContracts.map((entry) => entry.contractId)).toEqual([
            'original',
            cid,
            'new-provider-cid',
        ]);
    });
    it.each(tags)(
        'preserves empty Wallet provider context and disclosure list for %s',
        async (tag) => {
            const f = setup(tag, { admin: 'issuer', id: 'Amulet' });
            f.api.getTransferInstructionContext.mockResolvedValue({
                choiceContext: { values: {} as { revision: string } },
                disclosedContracts: [],
            });
            expect((await f.resolve()).disclosedContracts.map((entry) => entry.contractId)).toEqual(
                ['original', cid],
            );
        },
    );
    it('accepts a valid Wallet provider disclosure without optional templateId', async () => {
        const f = setup(tags[0], { admin: 'issuer', id: 'Amulet' });
        const provider: Partial<ReturnType<typeof disclosure>> = disclosure(
            'provider-without-template',
        );
        delete provider.templateId;
        f.api.getTransferInstructionContext.mockResolvedValue({
            choiceContext: { values: { revision: 'valid' } },
            disclosedContracts: [provider as ReturnType<typeof disclosure>],
        });
        expect((await f.resolve()).disclosedContracts).toContainEqual(provider);
    });
});
