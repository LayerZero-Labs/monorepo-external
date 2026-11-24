import { describe, expect, it, vi } from 'vitest';

import type { ICantonClient } from '../../src/client/interface';
import { cantonSenderPartyRef } from '../../src/deferredValue';
import { resolveCantonRefreshPlan } from '../../src/refresh';
import {
    type CantonArgumentRefreshTarget,
    type CantonRefreshPath,
    type CantonRefreshPlan,
    cantonRefreshPlanSchema,
} from '../../src/refresh/plan';
import { type CantonDisclosedContract, cantonTransactionSchema } from '../../src/transaction';

const sender = 'assigned-sender';
const target = (path: CantonRefreshPath = [{ field: 'sender' }]): CantonArgumentRefreshTarget => ({
    commandIndex: 0,
    command: 'exercise',
    choice: 'Transfer',
    arguments: [{ path }],
});
const setup = () => {
    const command = {
        exerciseCommand: {
            templateId: 'pkg:Transfer:Transfer',
            contractId: 'transfer',
            choice: 'Transfer',
            choiceArgument: {
                sender: cantonSenderPartyRef(),
                recipient: 'recipient',
                amount: '3.0',
                signedExpiry: '2030-01-01T00:00:00.000Z',
                context: {},
            } as Record<string, unknown>,
        },
    };
    const refreshPlan: CantonRefreshPlan = {
        replaceSentinels: [{ kind: 'senderParty', targets: [target()] }],
        commands: [
            {
                resolver: { type: 'amuletContext', dsoParty: 'dso' },
                targets: [target([{ field: 'context' }])],
            },
        ],
    };
    const getAmuletContextWithExternalRules = vi.fn(async () => ({
        amuletContext: { values: { round: 'fresh' } },
        externalPartyAmuletRulesCid: 'rules',
        disclosedContracts: [] as CantonDisclosedContract[],
    }));
    return {
        command,
        getAmuletContextWithExternalRules,
        args: {
            unresolvedCommands: [command],
            unresolvedDisclosedContracts: [] as CantonDisclosedContract[],
            refreshPlan,
            senderParty: sender,
            signingParties: [sender],
            client: { getAmuletContextWithExternalRules } as unknown as ICantonClient,
        },
    };
};

describe('explicit sender binding', () => {
    it('round-trips the declaration and rebuilds the original signed intent', async () => {
        const { args, getAmuletContextWithExternalRules } = setup();
        const populated = {
            unresolvedCommands: args.unresolvedCommands,
            unresolvedDisclosedContracts: args.unresolvedDisclosedContracts,
            actAs: [],
            refreshPlan: args.refreshPlan,
        };
        const parsed = cantonTransactionSchema.parse({
            chainName: 'canton',
            timestamps: { created: 1 },
            populatedTransaction: JSON.parse(JSON.stringify(populated)),
        });
        expect(parsed.populatedTransaction).toEqual(populated);
        const baseline = structuredClone(populated);
        for (const round of ['first', 'second']) {
            getAmuletContextWithExternalRules.mockResolvedValue({
                amuletContext: { values: { round } },
                externalPartyAmuletRulesCid: 'rules',
                disclosedContracts: [],
            });
            const result = await resolveCantonRefreshPlan(args);
            expect(result.commands).toEqual([
                {
                    exerciseCommand: {
                        ...args.unresolvedCommands[0]!.exerciseCommand,
                        choiceArgument: {
                            sender,
                            recipient: 'recipient',
                            amount: '3.0',
                            signedExpiry: '2030-01-01T00:00:00.000Z',
                            context: { values: { round } },
                        },
                    },
                },
            ]);
            expect(populated).toEqual(baseline);
        }
    });

    it.each([
        {
            value: { nested: cantonSenderPartyRef() },
            path: [{ field: 'nested' }],
            expected: { nested: sender },
        },
        { value: [cantonSenderPartyRef()], path: [{ index: 0 }], expected: [sender] },
        {
            value: [['owner', cantonSenderPartyRef()]],
            path: [{ damlMapKey: 'owner' }],
            expected: [['owner', sender]],
        },
        {
            value: { list: [[['owner', { party: cantonSenderPartyRef() }]]] },
            path: [{ field: 'list' }, { index: 0 }, { damlMapKey: 'owner' }, { field: 'party' }],
            expected: { list: [[['owner', { party: sender }]]] },
        },
    ] as { value: unknown; path: CantonRefreshPath; expected: unknown }[])(
        'binds a declared nested path $path',
        async ({ value, path, expected }) => {
            const { args, command } = setup();
            command.exerciseCommand.choiceArgument.sender = value;
            args.refreshPlan.replaceSentinels![0]!.targets = [
                target([{ field: 'sender' }, ...path]),
            ];
            const baseline = structuredClone(args.unresolvedCommands);
            const result = await resolveCantonRefreshPlan(args);
            expect(result.commands[0]).toMatchObject({
                exerciseCommand: { choiceArgument: { sender: expected } },
            });
            expect(args.unresolvedCommands).toEqual(baseline);
        },
    );

    it('preserves the assigned sender string without normalization', async () => {
        const { args } = setup();
        const senderParty = ' assigned-sender ';
        const result = await resolveCantonRefreshPlan({ ...args, senderParty });
        expect(result.commands[0]).toMatchObject({
            exerciseCommand: { choiceArgument: { sender: senderParty } },
        });
    });

    it('binds create arguments, including a whole argument sentinel', async () => {
        const { args } = setup();
        args.refreshPlan.replaceSentinels![0]!.targets.push({
            commandIndex: 1,
            command: 'create',
            template: 'pkg:Owner:Owner',
            arguments: [{ path: [] }],
        });
        const original = [
            ...args.unresolvedCommands,
            {
                createCommand: {
                    templateId: 'pkg:Owner:Owner',
                    createArguments: cantonSenderPartyRef(),
                },
            },
        ];
        const result = await resolveCantonRefreshPlan({ ...args, unresolvedCommands: original });
        expect(result.commands[1]).toEqual({
            createCommand: { templateId: 'pkg:Owner:Owner', createArguments: sender },
        });
        expect(original[1]).toEqual({
            createCommand: {
                templateId: 'pkg:Owner:Owner',
                createArguments: cantonSenderPartyRef(),
            },
        });
    });

    it.each([undefined, '', '  ', 42, cantonSenderPartyRef()])(
        'rejects invalid assigned sender %s before external reads',
        async (senderParty) => {
            const { args, getAmuletContextWithExternalRules } = setup();
            const baseline = structuredClone(args.unresolvedCommands);
            await expect(
                resolveCantonRefreshPlan({ ...args, senderParty: senderParty as string }),
            ).rejects.toThrow('Sender binding requires a resolved sender party');
            expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
            expect(args.unresolvedCommands).toEqual(baseline);
        },
    );

    it.each([
        'already-concrete',
        '<<CANTON_DEFERRED:{"type":"amuletContext"}>>',
        '<<CANTON_DEFERRED:broken>>',
        '<<CANTON_DEFERRED:{"type":"senderParty","extra":true}>>',
    ])('requires the exact sender sentinel at a declared target: %s', async (value) => {
        const { args, command, getAmuletContextWithExternalRules } = setup();
        command.exerciseCommand.choiceArgument.sender = value;
        await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
            'must contain cantonSenderPartyRef()',
        );
        expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
        expect(command.exerciseCommand.choiceArgument.sender).toBe(value);
    });

    it.each([
        { ...target(), commandIndex: 10 },
        { ...target(), choice: 'WrongChoice' },
        target([{ field: 'missing' }]),
        target([{ field: 'sender' }, { index: 0 }]),
        { commandIndex: 0, command: 'create', template: 'wrong', arguments: [{ path: [] }] },
    ])('rejects an invalid target before reads: %s', async (bindingTarget) => {
        const { args, getAmuletContextWithExternalRules } = setup();
        args.refreshPlan.replaceSentinels![0]!.targets = [
            bindingTarget as CantonArgumentRefreshTarget,
        ];
        const baseline = structuredClone(args.unresolvedCommands);
        await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(/Refresh/);
        expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
        expect(args.unresolvedCommands).toEqual(baseline);
    });

    it.each(
        [
            [],
            [{ kind: 'unknown', targets: [target()] }],
            [{ kind: 'senderParty', targets: [] }],
            [
                {
                    kind: 'senderParty',
                    targets: [{ commandIndex: 0, command: 'exercise', field: 'contractId' }],
                },
            ],
            [{ kind: 'senderParty', targets: [target([{ field: 'sender', index: 0 } as never])] }],
            [{ kind: 'senderParty', targets: [target([{ index: -1 }])] }],
        ].map((replaceSentinels) => ({ replaceSentinels })),
    )(
        'rejects malformed declarations at schema and resolver boundaries: %s',
        async ({ replaceSentinels }) => {
            const { args, getAmuletContextWithExternalRules } = setup();
            const refreshPlan = { ...args.refreshPlan, replaceSentinels } as CantonRefreshPlan;
            expect(cantonRefreshPlanSchema.safeParse(refreshPlan).success).toBe(false);
            await expect(resolveCantonRefreshPlan({ ...args, refreshPlan })).rejects.toThrow();
            expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
        },
    );

    it('still requires at least one freshness command', () => {
        const { args } = setup();
        expect(
            cantonRefreshPlanSchema.safeParse({ ...args.refreshPlan, commands: [] }).success,
        ).toBe(false);
    });

    it.each(['same-path', 'map-index-alias'])(
        'rejects duplicate binding locations (%s) without mutating the original',
        async (form) => {
            const { args, command, getAmuletContextWithExternalRules } = setup();
            const paths: CantonRefreshPath[] =
                form === 'same-path'
                    ? [[{ field: 'sender' }], [{ field: 'sender' }]]
                    : [
                          [{ field: 'sender' }, { damlMapKey: 'owner' }],
                          [{ field: 'sender' }, { index: 0 }, { index: 1 }],
                      ];
            if (form === 'map-index-alias')
                command.exerciseCommand.choiceArgument.sender = [['owner', cantonSenderPartyRef()]];
            args.refreshPlan.replaceSentinels![0]!.targets = paths.map(target);
            const baseline = structuredClone(args.unresolvedCommands);
            await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
                'must contain cantonSenderPartyRef()',
            );
            expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
            expect(args.unresolvedCommands).toEqual(baseline);
        },
    );

    it.each(['nested', 'createdEventBlob', 'unsupported'])(
        'rejects undeclared %s command sentinels before reads',
        async (field) => {
            const { args, command, getAmuletContextWithExternalRules } = setup();
            command.exerciseCommand.choiceArgument[field] = {
                nested:
                    field === 'unsupported'
                        ? '<<CANTON_DEFERRED:{"type":"amuletContext"}>>'
                        : cantonSenderPartyRef(),
            };
            const baseline = structuredClone(args.unresolvedCommands);
            await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
                'cannot be combined with deferred sentinels',
            );
            expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
            expect(args.unresolvedCommands).toEqual(baseline);
        },
    );

    it('rejects undeclared sender binding', async () => {
        const { args, getAmuletContextWithExternalRules } = setup();
        delete args.refreshPlan.replaceSentinels;
        await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
            'cannot be combined with deferred sentinels',
        );
        expect(getAmuletContextWithExternalRules).not.toHaveBeenCalled();
    });

    it('keeps actual disclosure blobs opaque', async () => {
        const { args } = setup();
        args.unresolvedDisclosedContracts.push({
            contractId: 'cid',
            synchronizerId: 'sync',
            createdEventBlob: cantonSenderPartyRef(),
        });
        expect((await resolveCantonRefreshPlan(args)).disclosedContracts).toEqual(
            args.unresolvedDisclosedContracts,
        );
    });

    it.each(['changed', 'removed', 'preserved'])(
        'checks bound identity after a parent refresh: %s',
        async (outcome) => {
            const { args, getAmuletContextWithExternalRules } = setup();
            args.refreshPlan.commands[0]!.targets = [target([])];
            const fresh =
                outcome === 'removed'
                    ? {}
                    : { sender: outcome === 'preserved' ? sender : 'other-sender' };
            getAmuletContextWithExternalRules.mockResolvedValue({
                amuletContext: fresh as never,
                externalPartyAmuletRulesCid: 'rules',
                disclosedContracts: [],
            });
            const baseline = structuredClone(args.unresolvedCommands);
            if (outcome === 'preserved') {
                expect((await resolveCantonRefreshPlan(args)).commands[0]).toMatchObject({
                    exerciseCommand: { choiceArgument: { sender } },
                });
            } else {
                await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
                    /bound sender|does not exist/,
                );
            }
            expect(args.unresolvedCommands).toEqual(baseline);
        },
    );

    it('rejects refresh writes through a DAML map/index alias of the binding', async () => {
        const { args, command } = setup();
        command.exerciseCommand.choiceArgument.sender = [['owner', cantonSenderPartyRef()]];
        args.refreshPlan.replaceSentinels![0]!.targets = [
            target([{ field: 'sender' }, { damlMapKey: 'owner' }]),
        ];
        args.refreshPlan.commands[0]!.targets = [
            target([{ field: 'sender' }, { index: 0 }, { index: 1 }]),
        ];
        await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
            'cannot change the bound sender',
        );
    });

    it('rejects sentinels introduced by fresh command data', async () => {
        const { args, getAmuletContextWithExternalRules } = setup();
        getAmuletContextWithExternalRules.mockResolvedValue({
            amuletContext: { values: { round: cantonSenderPartyRef() } },
            externalPartyAmuletRulesCid: 'rules',
            disclosedContracts: [],
        });
        await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
            'cannot return deferred sentinels',
        );
    });
});
