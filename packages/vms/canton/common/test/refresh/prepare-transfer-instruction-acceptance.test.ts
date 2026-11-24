import { describe, expect, it, vi } from 'vitest';

import {
    type CantonDisclosedContract,
    type CantonPopulatedTransaction,
    cantonRefreshPlanSchema,
    type ICantonClient,
    prepareRefreshableTransferInstructionAcceptance,
    resolveCantonRefreshPlan,
} from '../../src';

const PARTY = 'receiver::namespace';
const CID = 'instruction-1';
const disclosure = (contractId: string): CantonDisclosedContract => ({
    contractId,
    templateId: 'package:Module:Rules',
    createdEventBlob: `blob-${contractId}`,
    synchronizerId: 'sync',
});
const bundle = (version: string) => ({
    choiceContext: { values: { round: { tag: 'AV_ContractId', value: `round-${version}` } } },
    disclosedContracts: [disclosure(`round-${version}`)],
});
const setup = () => {
    const getPackageId = vi.fn(async () => 'interface-package');
    const getTransferInstructionAcceptContext = vi.fn(async () => bundle('original'));
    const client = {
        getPackageId,
        getTransferInstructionAcceptContext,
    } as unknown as ICantonClient;
    return {
        client,
        getPackageId,
        getTransferInstructionAcceptContext,
        populate: () =>
            prepareRefreshableTransferInstructionAcceptance({
                client,
                partyId: PARTY,
                contractId: CID,
            }),
    };
};
const resolve = (populated: CantonPopulatedTransaction, client: ICantonClient) => {
    if (!populated.refreshPlan) throw new Error('Expected refresh plan');
    return resolveCantonRefreshPlan({
        ...populated,
        refreshPlan: populated.refreshPlan,
        client,
        signingParties: populated.actAs,
    });
};

describe('refreshable transfer-instruction acceptance', () => {
    it('populates a concrete acceptance and serializable pinned plan through the public export', async () => {
        const { populate, getPackageId, getTransferInstructionAcceptContext } = setup();
        const populated = await populate();
        expect(getPackageId).toHaveBeenCalledWith('splice-api-token-transfer-instruction-v1', [
            PARTY,
        ]);
        expect(getTransferInstructionAcceptContext).toHaveBeenCalledWith({ contractId: CID });
        expect(populated.actAs).toEqual([PARTY]);
        expect(populated.unresolvedCommands).toEqual([
            {
                exerciseCommand: {
                    templateId:
                        'interface-package:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
                    contractId: CID,
                    choice: 'TransferInstruction_Accept',
                    choiceArgument: {
                        extraArgs: {
                            context: bundle('original').choiceContext,
                            meta: { values: {} },
                        },
                    },
                },
            },
        ]);
        expect(populated.unresolvedDisclosedContracts).toEqual(
            bundle('original').disclosedContracts,
        );
        expect(
            cantonRefreshPlanSchema.parse(JSON.parse(JSON.stringify(populated.refreshPlan))),
        ).toEqual(populated.refreshPlan);
    });

    it('uses explicit package-vetting parties without changing the accepting party', async () => {
        const { client, getPackageId } = setup();
        const packageVettingParties = [PARTY, 'provider::namespace'];
        const populated = await prepareRefreshableTransferInstructionAcceptance({
            client,
            partyId: PARTY,
            contractId: CID,
            packageVettingParties,
        });
        expect(getPackageId).toHaveBeenCalledWith(
            'splice-api-token-transfer-instruction-v1',
            packageVettingParties,
        );
        expect(populated.actAs).toEqual([PARTY]);
    });

    it('rebuilds from the original baseline, retaining all original disclosures and immutable intent', async () => {
        const { populate, client, getTransferInstructionAcceptContext } = setup();
        const populated = await populate();
        populated.unresolvedDisclosedContracts.push(disclosure(CID));
        const original = structuredClone(populated);
        getTransferInstructionAcceptContext.mockResolvedValueOnce({
            ...bundle('first'),
            disclosedContracts: [...bundle('first').disclosedContracts, disclosure(CID)],
        });
        getTransferInstructionAcceptContext.mockResolvedValueOnce(bundle('second'));
        const first = await resolve(populated, client);
        const second = await resolve(populated, client);
        for (const [result, version] of [
            [first, 'first'],
            [second, 'second'],
        ] as const) {
            const expected = structuredClone(original.unresolvedCommands);
            const command = expected[0]!;
            if (!('exerciseCommand' in command)) throw new Error('Expected exercise');
            command.exerciseCommand.choiceArgument = {
                extraArgs: { context: bundle(version).choiceContext, meta: { values: {} } },
            };
            expect(result.commands).toEqual(expected);
            expect(result.disclosedContracts).toEqual([
                ...original.unresolvedDisclosedContracts,
                ...bundle(version).disclosedContracts,
            ]);
        }
        expect(populated).toEqual(original);
        expect(getTransferInstructionAcceptContext.mock.calls).toEqual(
            Array.from({ length: 3 }, () => [{ contractId: CID }]),
        );
    });

    it('rejects conflicts against the original disclosure baseline', async () => {
        const { populate, client, getTransferInstructionAcceptContext } = setup();
        const populated = await populate();
        getTransferInstructionAcceptContext.mockResolvedValueOnce({
            ...bundle('fresh'),
            disclosedContracts: [{ ...disclosure('round-original'), createdEventBlob: 'conflict' }],
        });
        await expect(resolve(populated, client)).rejects.toThrow('Conflicting disclosures');
    });

    it.each([
        'choice',
        'type',
        'index',
        'cid',
        'path',
        'targetChoice',
        'cidTarget',
        'emptyCid',
    ] as const)('rejects invalid %s before reading the provider', async (invalid) => {
        const { populate, client, getTransferInstructionAcceptContext } = setup();
        const populated = await populate();
        const command = populated.unresolvedCommands[0]!;
        if (!('exerciseCommand' in command)) throw new Error('Expected exercise');
        const refresh = populated.refreshPlan!.commands[0]!;
        const target = refresh.targets[0]!;
        if (invalid === 'choice') command.exerciseCommand.choice = 'Other';
        if (invalid === 'type')
            populated.unresolvedCommands[0] = {
                createCommand: { templateId: 'pkg:Module:Name', createArguments: {} },
            };
        if (invalid === 'index') target.commandIndex = 1;
        if (invalid === 'cid') command.exerciseCommand.contractId = 'other-instruction';
        if (invalid === 'path')
            Object.assign(target, {
                arguments: [{ path: [{ field: 'extraArgs' }, { field: 'meta' }] }],
            });
        if (invalid === 'targetChoice') Object.assign(target, { choice: 'Other' });
        if (invalid === 'cidTarget') Object.assign(target, { field: 'contractId' });
        if (invalid === 'emptyCid') Object.assign(refresh.resolver, { contractId: '' });
        getTransferInstructionAcceptContext.mockClear();
        await expect(resolve(populated, client)).rejects.toThrow();
        expect(getTransferInstructionAcceptContext).not.toHaveBeenCalled();
    });

    it.each(['before', 'after'] as const)(
        'rejects a conflicting instruction CID refresh declared %s acceptance',
        async (order) => {
            const { populate, client, getTransferInstructionAcceptContext } = setup();
            const populated = await populate();
            const conflicting = {
                resolver: {
                    type: 'activeContract',
                    selector: {
                        queryAs: { party: PARTY },
                        templateId: 'package:Module:Rules',
                        expectedSignatories: [PARTY],
                    },
                    selection: { kind: 'exactlyOne' },
                },
                targets: [{ commandIndex: 0, command: 'exercise', field: 'contractId' }],
            };
            const acceptance = populated.refreshPlan!.commands[0]!;
            populated.refreshPlan = cantonRefreshPlanSchema.parse({
                commands:
                    order === 'before' ? [conflicting, acceptance] : [acceptance, conflicting],
            });
            Object.assign(client, {
                getLedgerEndOffset: vi.fn(async () => 1),
                queryActiveContracts: vi.fn(async () => [
                    {
                        createdEvent: {
                            ...disclosure('instruction-2'),
                            createArgument: {},
                            signatories: [PARTY],
                            observers: [],
                        },
                        synchronizerId: 'sync',
                    },
                ]),
            });
            getTransferInstructionAcceptContext.mockClear();
            await expect(resolve(populated, client)).rejects.toThrow('pinned transfer instruction');
            expect(getTransferInstructionAcceptContext).toHaveBeenCalledTimes(
                order === 'before' ? 0 : 1,
            );
            expect(populated.unresolvedCommands[0]).toMatchObject({
                exerciseCommand: { contractId: CID },
            });
        },
    );

    it('propagates provider failures during population and refresh', async () => {
        const { populate, client, getTransferInstructionAcceptContext } = setup();
        const error = new Error('pinned instruction unavailable');
        getTransferInstructionAcceptContext.mockRejectedValueOnce(error);
        await expect(populate()).rejects.toBe(error);
        const populated = await populate();
        getTransferInstructionAcceptContext.mockRejectedValueOnce(error);
        await expect(resolve(populated, client)).rejects.toBe(error);
    });
});
