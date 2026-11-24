import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    type AmuletContextResult,
    type CantonDisclosedContract,
    type CantonPopulatedTransaction,
    cantonSenderPartyRef,
    cantonTransactionSchema,
    type ICantonClient,
    type JsActiveContract,
    prepareRefreshableAmuletTransfer,
    resolveCantonRefreshPlan,
} from '../../src';

const DSO = 'dso::namespace';
const SENDER = 'sender::namespace';
const RECEIVER = 'receiver::namespace';
const AMULET_TEMPLATE = '#splice-amulet:Splice.Amulet:Amulet';
const FACTORY_TEMPLATE =
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';

const disclosure = (contractId: string): CantonDisclosedContract => ({
    contractId,
    templateId: 'pkg:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules',
    createdEventBlob: `blob-${contractId}`,
    synchronizerId: 'sync',
});

const bundle = (version: string): AmuletContextResult => ({
    amuletContext: {
        values: {
            'external-party-amulet-rules': { tag: 'AV_ContractId', value: `rules-${version}` },
        },
    },
    externalPartyAmuletRulesCid: `rules-${version}`,
    disclosedContracts: [disclosure(`rules-${version}`)],
});

const holding = (
    contractId: string,
    amount = '2.5',
    owner = SENDER,
    signatories = [DSO],
): JsActiveContract =>
    ({
        createdEvent: {
            contractId,
            templateId: 'pkg:Splice.Amulet:Amulet',
            createArgument: { owner, amount: { initialAmount: amount } },
            signatories,
            observers: [owner],
            createdEventBlob: `blob-${contractId}`,
        },
        synchronizerId: 'sync',
    }) as JsActiveContract;

const setup = () => {
    const getDsoParty = vi.fn(async () => DSO);
    const getAmuletContextWithExternalRules = vi.fn(async () => bundle('original'));
    const getLedgerEndOffset = vi.fn(async () => 42);
    const queryActiveContracts = vi.fn(async () => [holding('holding-1')]);
    const client = {
        getDsoParty,
        getAmuletContextWithExternalRules,
        getLedgerEndOffset,
        queryActiveContracts,
    } as unknown as ICantonClient;
    return {
        client,
        getDsoParty,
        getAmuletContextWithExternalRules,
        getLedgerEndOffset,
        queryActiveContracts,
        populate: (amount = '2.5') =>
            prepareRefreshableAmuletTransfer({ client, receiverParty: RECEIVER, amount }),
    };
};

const resolve = (
    populated: CantonPopulatedTransaction,
    client: ICantonClient,
    senderParty?: string,
) => {
    if (!populated.refreshPlan) throw new Error('Expected refresh plan');
    return resolveCantonRefreshPlan({
        ...populated,
        refreshPlan: populated.refreshPlan,
        client,
        senderParty,
        signingParties: senderParty ? [senderParty] : [],
    });
};

describe('prepareRefreshableAmuletTransfer', () => {
    afterEach(() => vi.useRealTimers());

    it('populates a concrete Wallet bundle and serializable declared initial funding', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
        const { populate, getDsoParty, getAmuletContextWithExternalRules, queryActiveContracts } =
            setup();

        const populated = await populate();

        expect(getDsoParty).toHaveBeenCalledOnce();
        expect(getAmuletContextWithExternalRules).toHaveBeenCalledExactlyOnceWith(
            { admin: DSO, id: 'Amulet' },
            { receiver: RECEIVER, amount: '2.5' },
        );
        expect(queryActiveContracts).not.toHaveBeenCalled();
        expect(populated.actAs).toEqual([]);
        expect(populated.unresolvedCommands).toEqual([
            {
                exerciseCommand: {
                    templateId: FACTORY_TEMPLATE,
                    contractId: 'rules-original',
                    choice: 'TransferFactory_Transfer',
                    choiceArgument: {
                        expectedAdmin: DSO,
                        transfer: {
                            sender: cantonSenderPartyRef(),
                            receiver: RECEIVER,
                            amount: '2.5',
                            instrumentId: { admin: DSO, id: 'Amulet' },
                            lock: null,
                            requestedAt: '2026-10-01T12:00:00.000Z',
                            executeBefore: '2026-10-02T12:00:00.000Z',
                            inputHoldingCids: [],
                            meta: { values: {} },
                        },
                        extraArgs: {
                            context: bundle('original').amuletContext,
                            meta: { values: {} },
                        },
                    },
                },
            },
        ]);
        expect(populated.unresolvedDisclosedContracts).toEqual(
            bundle('original').disclosedContracts,
        );
        const parsed = cantonTransactionSchema.parse({
            chainName: 'canton',
            timestamps: { created: 1 },
            populatedTransaction: JSON.parse(JSON.stringify(populated)),
        });
        expect(parsed.populatedTransaction).toEqual(populated);
        expect(populated.refreshPlan?.commands[0]?.resolver).toMatchObject({
            type: 'activeContract',
            selection: { kind: 'gte', field: 'amount', value: '2.5' },
        });
        expect(populated.refreshPlan?.commands[1]?.resolver).toEqual({
            type: 'amuletContext',
            dsoParty: DSO,
            receiver: RECEIVER,
            amount: '2.5',
        });
    });

    it('binds the assigned sender and replaces different numbers of authenticated holdings from originals', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
        const { populate, client, queryActiveContracts, getAmuletContextWithExternalRules } =
            setup();
        const populated = await populate('10');
        const originalCommand = populated.unresolvedCommands[0];
        if (!originalCommand || !('exerciseCommand' in originalCommand)) {
            throw new Error('Expected exercise command');
        }
        originalCommand.exerciseCommand.choiceArgument.transfer.inputHoldingCids = [
            'original-holding',
        ];
        const baseline = structuredClone(populated);

        for (const [version, amounts] of [
            ['first', ['6', '4']],
            ['second', ['4', '3', '3']],
        ] as const) {
            const freshHoldings = amounts.map((amount, index) =>
                holding(`holding-${version}-${index}`, amount),
            );
            queryActiveContracts.mockResolvedValue([
                ...freshHoldings,
                holding('wrong-owner', '100', RECEIVER),
                holding('wrong-authority', '100', SENDER, ['impostor']),
            ]);
            getAmuletContextWithExternalRules.mockImplementation(async () => {
                vi.setSystemTime(new Date('2026-10-03T12:01:00.000Z'));
                return bundle(version);
            });
            const result = await resolve(populated, client, SENDER);

            expect(queryActiveContracts).toHaveBeenLastCalledWith(SENDER, 42, {
                templateIds: [AMULET_TEMPLATE],
                includeCreatedEventBlob: true,
            });
            expect(getAmuletContextWithExternalRules).toHaveBeenLastCalledWith(
                { admin: DSO, id: 'Amulet' },
                { receiver: RECEIVER, amount: '10' },
            );
            expect(result.commands).toEqual([
                {
                    exerciseCommand: {
                        templateId: FACTORY_TEMPLATE,
                        contractId: `rules-${version}`,
                        choice: 'TransferFactory_Transfer',
                        choiceArgument: {
                            expectedAdmin: DSO,
                            transfer: {
                                sender: SENDER,
                                receiver: RECEIVER,
                                amount: '10',
                                instrumentId: { admin: DSO, id: 'Amulet' },
                                lock: null,
                                requestedAt: '2026-10-03T12:01:00.000Z',
                                executeBefore: '2026-10-04T12:01:00.000Z',
                                inputHoldingCids: freshHoldings.map(
                                    ({ createdEvent }) => createdEvent.contractId,
                                ),
                                meta: { values: {} },
                            },
                            extraArgs: {
                                context: bundle(version).amuletContext,
                                meta: { values: {} },
                            },
                        },
                    },
                },
            ]);
            expect(result.disclosedContracts).toEqual([
                ...bundle('original').disclosedContracts,
                ...bundle(version).disclosedContracts,
            ]);
            expect(populated).toEqual(baseline);
        }
        expect(getAmuletContextWithExternalRules).toHaveBeenCalledTimes(3);
    });

    it('keeps the receiver preapproval context and disclosures through population and refresh', async () => {
        const preapproval = (version: string): AmuletContextResult => {
            const base = bundle(version);
            return {
                ...base,
                amuletContext: {
                    values: {
                        ...base.amuletContext.values,
                        'transfer-preapproval': {
                            tag: 'AV_ContractId',
                            value: `preapproval-${version}`,
                        },
                    },
                },
                disclosedContracts: [
                    ...base.disclosedContracts,
                    {
                        ...disclosure(`preapproval-${version}`),
                        templateId: 'pkg:Splice.AmuletRules:TransferPreapproval',
                    },
                ],
            };
        };
        const { populate, client, getAmuletContextWithExternalRules } = setup();
        getAmuletContextWithExternalRules
            .mockResolvedValueOnce(preapproval('original'))
            .mockResolvedValueOnce(preapproval('fresh'));

        const populated = await populate();
        const result = await resolve(populated, client, SENDER);

        expect(populated.unresolvedCommands).toMatchObject([
            {
                exerciseCommand: {
                    choiceArgument: {
                        extraArgs: { context: preapproval('original').amuletContext },
                    },
                },
            },
        ]);
        expect(populated.unresolvedDisclosedContracts).toEqual(
            preapproval('original').disclosedContracts,
        );
        expect(result.commands).toMatchObject([
            {
                exerciseCommand: {
                    choiceArgument: { extraArgs: { context: preapproval('fresh').amuletContext } },
                },
            },
        ]);
        expect(result.disclosedContracts).toEqual([
            ...preapproval('original').disclosedContracts,
            ...preapproval('fresh').disclosedContracts,
        ]);
        expect(getAmuletContextWithExternalRules).toHaveBeenLastCalledWith(
            { admin: DSO, id: 'Amulet' },
            { receiver: RECEIVER, amount: '2.5' },
        );
    });

    it.each([
        { amount: '10', holdings: ['12', '5'], selected: [0] },
        { amount: '0.3', holdings: ['0.2', '0.1'], selected: [0, 1] },
    ])(
        'resolves initially empty funding by required value: $amount from $holdings',
        async ({ amount, holdings, selected }) => {
            const { populate, client, queryActiveContracts } = setup();
            const populated = await populate(amount);
            const baseline = structuredClone(populated);
            queryActiveContracts.mockResolvedValue(
                holdings.map((value, index) => holding(`holding-${index}`, value)),
            );

            const result = await resolve(populated, client, SENDER);

            expect(result.commands).toMatchObject([
                {
                    exerciseCommand: {
                        choiceArgument: {
                            transfer: {
                                amount,
                                sender: SENDER,
                                inputHoldingCids: selected.map((index) => `holding-${index}`),
                            },
                        },
                    },
                },
            ]);
            expect(populated).toEqual(baseline);
        },
    );

    it('rejects insufficient authenticated value before further refresh reads', async () => {
        const { populate, client, queryActiveContracts, getAmuletContextWithExternalRules } =
            setup();
        const populated = await populate('10');
        const baseline = structuredClone(populated);
        queryActiveContracts.mockResolvedValue([
            holding('holding-1', '3'),
            holding('holding-2', '2'),
            holding('wrong-owner', '100', RECEIVER),
            holding('wrong-authority', '100', SENDER, ['impostor']),
        ]);
        getAmuletContextWithExternalRules.mockClear();

        await expect(resolve(populated, client, SENDER)).rejects.toThrow(
            'Insufficient contract value in field amount: requested 10',
        );

        expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
        expect(populated).toEqual(baseline);
    });

    it.each([undefined, '', '   '])(
        'rejects missing sender %j before refresh reads',
        async (senderParty) => {
            const { populate, client, queryActiveContracts, getAmuletContextWithExternalRules } =
                setup();
            const populated = await populate();
            const baseline = structuredClone(populated);
            getAmuletContextWithExternalRules.mockClear();

            await expect(resolve(populated, client, senderParty)).rejects.toThrow(
                'Sender binding requires a resolved sender party',
            );

            expect(queryActiveContracts).not.toHaveBeenCalled();
            expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
            expect(populated).toEqual(baseline);
        },
    );

    it.each([
        { contracts: [] },
        { contracts: [holding('wrong-owner', '100', RECEIVER)] },
        { contracts: [holding('wrong-authority', '100', SENDER, ['impostor'])] },
    ])('rejects no authenticated owned holdings: $contracts', async ({ contracts }) => {
        const { populate, client, queryActiveContracts, getAmuletContextWithExternalRules } =
            setup();
        const populated = await populate();
        const baseline = structuredClone(populated);
        queryActiveContracts.mockResolvedValue(contracts);
        getAmuletContextWithExternalRules.mockClear();

        await expect(resolve(populated, client, SENDER)).rejects.toThrow(
            'has no matching active contracts',
        );

        expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
        expect(populated).toEqual(baseline);
    });

    it('retains duplicate disclosure checks for a refreshed factory bundle', async () => {
        const { populate, client, getAmuletContextWithExternalRules } = setup();
        const populated = await populate();
        const baseline = structuredClone(populated);
        getAmuletContextWithExternalRules.mockResolvedValue(bundle('original'));
        expect((await resolve(populated, client, SENDER)).disclosedContracts).toEqual(
            bundle('original').disclosedContracts,
        );

        getAmuletContextWithExternalRules.mockResolvedValue({
            ...bundle('original'),
            disclosedContracts: [
                { ...disclosure('rules-original'), createdEventBlob: 'conflicting' },
            ],
        });
        await expect(resolve(populated, client, SENDER)).rejects.toThrow(
            'Conflicting disclosures for contract rules-original',
        );
        expect(populated).toEqual(baseline);
    });

    it('propagates Wallet population failure', async () => {
        const { populate, getAmuletContextWithExternalRules } = setup();
        getAmuletContextWithExternalRules.mockRejectedValue(
            new Error('ExternalPartyAmuletRules not found'),
        );
        await expect(populate()).rejects.toThrow('ExternalPartyAmuletRules not found');
    });
});
