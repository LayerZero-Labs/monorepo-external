import { afterEach, describe, expect, it, vi } from 'vitest';

import { CantonClient } from '../../src/client/canton-client';
import type { ICantonClient } from '../../src/client/interface';
import { cantonActiveContractIdRef } from '../../src/deferredValue';
import type { JsActiveContract } from '../../src/open-api/models';
import { Configuration } from '../../src/open-api/runtime';
import { resolveCantonRefreshPlan, selectContractsByGte } from '../../src/refresh';
import { type CantonRefreshPlan, cantonRefreshPlanSchema } from '../../src/refresh/plan';
import {
    type CantonDisclosedContract,
    cantonTransactionSchema,
    type CantonUnresolvedCommand,
} from '../../src/transaction';

const RICH = 'rich::namespace';
const DSO = 'dso::namespace';
const INFORMEE = 'informee::namespace';

const activeContract = (args: {
    contractId: string;
    templateId: string;
    createArgument: Record<string, unknown>;
    signatories: string[];
    observers?: string[];
    blob?: string;
}): JsActiveContract =>
    ({
        createdEvent: {
            offset: 1,
            nodeId: 0,
            contractId: args.contractId,
            templateId: args.templateId,
            createArgument: args.createArgument,
            signatories: args.signatories,
            observers: args.observers ?? [],
            createdEventBlob: args.blob ?? `blob-${args.contractId}`,
            createdAt: '2026-01-01T00:00:00.000Z',
            packageName: 'package',
            representativePackageId: 'package-id',
            acsDelta: true,
        },
        synchronizerId: 'sync',
        reassignmentCounter: 0,
    }) as JsActiveContract;

const amulet = (contractId: string, amount: string): JsActiveContract =>
    activeContract({
        contractId,
        templateId: 'pkg:Splice.Amulet:Amulet',
        createArgument: { owner: RICH, amount: { initialAmount: amount } },
        signatories: [DSO],
        observers: [RICH],
    });

type ExerciseCommand = Extract<CantonUnresolvedCommand, { exerciseCommand: unknown }>;
type CreateCommand = Extract<CantonUnresolvedCommand, { createCommand: unknown }>;

const delegateCommand = (): ExerciseCommand => ({
    exerciseCommand: {
        templateId: 'pkg:Executor:Executor',
        contractId: 'stale-executor',
        choice: 'DelegateLzReceive',
        choiceArgument: {
            amuletCids: ['stale-amulet'],
            amuletContext: { values: { stale: true } },
            timestamp: '2020-01-01T00:00:00.000Z',
            callArgs: [['timestamp', { tag: 'AV_Time', value: '2020-01-01T00:00:00.000Z' }]],
        },
    },
});

const timedCreateCommand = (): CreateCommand => ({
    createCommand: {
        templateId: 'pkg:Timed:Timed',
        createArguments: {
            executeBefore: '2020-01-01T00:00:00.000Z',
        },
    },
});

const getExercise = (command: CantonUnresolvedCommand) => {
    if (!('exerciseCommand' in command)) throw new Error('Expected exercise command');
    return command.exerciseCommand;
};

const plan = (): CantonRefreshPlan => ({
    commands: [
        {
            resolver: {
                type: 'activeContract',
                selector: {
                    queryAs: { party: RICH },
                    templateId: '#layerzero-executor:Executor:Executor',
                    expectedSignatories: [RICH],
                },
                selection: { kind: 'exactlyOne' },
            },
            targets: [
                {
                    commandIndex: 0,
                    command: 'exercise',
                    field: 'contractId',
                },
            ],
        },
        {
            resolver: {
                type: 'activeContract',
                selector: {
                    queryAs: { party: RICH },
                    templateId: '#splice-amulet:Splice.Amulet:Amulet',
                    expectedSignatories: [DSO],
                    stateFilter: { owner: RICH },
                },
                selection: { kind: 'gte', field: 'amount', value: '5.0' },
            },
            targets: [
                {
                    commandIndex: 0,
                    command: 'exercise',
                    choice: 'DelegateLzReceive',
                    arguments: [{ path: [{ field: 'amuletCids' }] }],
                },
            ],
        },
        {
            resolver: {
                type: 'amuletContext',
                dsoParty: DSO,
            },
            targets: [
                {
                    commandIndex: 0,
                    command: 'exercise',
                    choice: 'DelegateLzReceive',
                    arguments: [{ path: [{ field: 'amuletContext' }] }],
                },
            ],
        },
        {
            resolver: {
                type: 'timestamp',
            },
            targets: [
                {
                    commandIndex: 0,
                    command: 'exercise',
                    choice: 'DelegateLzReceive',
                    arguments: [
                        { path: [{ field: 'timestamp' }] },
                        {
                            path: [{ field: 'callArgs' }, { damlMapKey: 'timestamp' }],
                        },
                    ],
                },
            ],
        },
    ],
});

describe('Canton refresh plan', () => {
    it('round-trips through the populated transaction schema', () => {
        const refreshPlan = plan();
        const parsed = cantonTransactionSchema.parse({
            chainName: 'canton',
            timestamps: { created: 1 },
            populatedTransaction: {
                unresolvedCommands: [delegateCommand()],
                unresolvedDisclosedContracts: [],
                actAs: [RICH],
                refreshPlan,
            },
        });
        expect(JSON.parse(JSON.stringify(parsed.populatedTransaction.refreshPlan))).toEqual(
            refreshPlan,
        );
    });

    it('requires choice for choice-argument targets', () => {
        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: { type: 'timestamp' },
                        targets: [
                            {
                                commandIndex: 0,
                                command: 'exercise',
                                arguments: [{ path: [{ field: 'timestamp' }] }],
                            },
                        ],
                    },
                ],
            }).success,
        ).toBe(false);
    });

    it('restricts command resolvers to compatible targets', () => {
        const contractIdTarget = {
            commandIndex: 0,
            command: 'exercise',
            field: 'contractId',
        };

        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: { type: 'timestamp' },
                        targets: [contractIdTarget],
                    },
                ],
            }).success,
        ).toBe(false);
        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: { type: 'amuletContext', dsoParty: DSO },
                        targets: [contractIdTarget],
                    },
                ],
            }).success,
        ).toBe(false);
        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: {
                            type: 'activeContract',
                            selector: {
                                queryAs: { party: RICH },
                                templateId: '#splice-amulet:Splice.Amulet:Amulet',
                                expectedSignatories: [DSO],
                            },
                            selection: { kind: 'gte', field: 'amount', value: '5.0' },
                        },
                        targets: [contractIdTarget],
                    },
                ],
            }).success,
        ).toBe(false);
    });

    it('requires timestamp targets to have a nested path', () => {
        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: { type: 'timestamp' },
                        targets: [
                            {
                                commandIndex: 0,
                                command: 'exercise',
                                choice: 'DelegateLzReceive',
                                arguments: [{ path: [] }],
                            },
                        ],
                    },
                ],
            }).success,
        ).toBe(false);
    });

    it('applies timestamps after external refreshes regardless of declaration order', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
            const client = {
                getAmuletContextWithExternalRules: vi.fn(async () => {
                    vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
                    return {
                        amuletContext: { values: { fresh: true } },
                        externalPartyAmuletRulesCid: 'rules',
                        disclosedContracts: [],
                    };
                }),
            } as unknown as ICantonClient;

            const result = await resolveCantonRefreshPlan({
                unresolvedCommands: [delegateCommand()],
                unresolvedDisclosedContracts: [],
                refreshPlan: {
                    commands: [
                        {
                            resolver: { type: 'timestamp' },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'DelegateLzReceive',
                                    arguments: [{ path: [{ field: 'timestamp' }] }],
                                },
                            ],
                        },
                        {
                            resolver: { type: 'amuletContext', dsoParty: DSO },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'DelegateLzReceive',
                                    arguments: [{ path: [{ field: 'amuletContext' }] }],
                                },
                            ],
                        },
                    ],
                },
                signingParties: [RICH],
                client,
            });

            const exercise = getExercise(result.commands[0]!);
            expect(exercise.choiceArgument).toMatchObject({
                timestamp: '2026-01-01T00:01:00.000Z',
                amuletContext: { values: { fresh: true } },
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects timestamp targets whose current value is not a Canton Time', async () => {
        const command = delegateCommand();
        (command.exerciseCommand.choiceArgument as Record<string, unknown>).guid = 'not-a-time';

        await expect(
            resolveCantonRefreshPlan({
                unresolvedCommands: [command],
                unresolvedDisclosedContracts: [],
                refreshPlan: {
                    commands: [
                        {
                            resolver: { type: 'timestamp' },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'DelegateLzReceive',
                                    arguments: [{ path: [{ field: 'guid' }] }],
                                },
                            ],
                        },
                    ],
                },
                signingParties: [RICH],
                client: {} as ICantonClient,
            }),
        ).rejects.toThrow(/must contain a Canton Time/);
    });

    it('patches a timestamp inside nested DAML maps', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'));
            const command = delegateCommand();
            (command.exerciseCommand.choiceArgument as Record<string, unknown>).nestedMaps = [
                ['outer', [['inner', { tag: 'AV_Time', value: '2020-01-01T00:00:00.000Z' }]]],
            ];

            const result = await resolveCantonRefreshPlan({
                unresolvedCommands: [command],
                unresolvedDisclosedContracts: [],
                refreshPlan: {
                    commands: [
                        {
                            resolver: { type: 'timestamp' },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'DelegateLzReceive',
                                    arguments: [
                                        {
                                            path: [
                                                { field: 'nestedMaps' },
                                                { damlMapKey: 'outer' },
                                                { damlMapKey: 'inner' },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                signingParties: [RICH],
                client: {} as ICantonClient,
            });

            expect(getExercise(result.commands[0]!).choiceArgument).toMatchObject({
                nestedMaps: [
                    ['outer', [['inner', { tag: 'AV_Time', value: '2026-02-03T04:05:06.000Z' }]]],
                ],
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('patches guarded create arguments with a per-patch offset', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'));
            const result = await resolveCantonRefreshPlan({
                unresolvedCommands: [timedCreateCommand()],
                unresolvedDisclosedContracts: [],
                refreshPlan: {
                    commands: [
                        {
                            resolver: { type: 'timestamp' },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'create',
                                    template: 'pkg:Timed:Timed',
                                    arguments: [
                                        {
                                            path: [{ field: 'executeBefore' }],
                                            offsetMs: 60_000,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                signingParties: [RICH],
                client: {} as ICantonClient,
            });

            expect(result.commands[0]).toMatchObject({
                createCommand: {
                    createArguments: {
                        executeBefore: '2026-02-03T04:06:06.000Z',
                    },
                },
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('uses latest ACS reads and one instant while retaining original disclosures', async () => {
        const executor = activeContract({
            contractId: 'fresh-executor',
            templateId: 'pkg:Executor:Executor',
            createArgument: {},
            signatories: [RICH],
        });
        const queryActiveContracts = vi.fn(
            async (_party: string, offset: number, opts?: { templateIds?: string[] }) => {
                expect(offset).toBe(42);
                if (opts?.templateIds?.[0]?.includes('Executor')) return [executor];
                return [amulet('amulet-3', '3.0'), amulet('amulet-4', '4.0')];
            },
        );
        const client = {
            getLedgerEndOffset: vi.fn(async () => 42),
            queryActiveContracts,
            getAmuletContextWithExternalRules: vi.fn(async () => ({
                amuletContext: { values: { fresh: true } },
                externalPartyAmuletRulesCid: 'fresh-rules',
                disclosedContracts: [
                    {
                        contractId: 'fresh-rules',
                        templateId: 'pkg:ExternalPartyAmuletRules',
                        createdEventBlob: 'fresh-rules-blob',
                        synchronizerId: 'sync',
                    },
                ],
            })),
        } as unknown as ICantonClient;
        const unresolvedCommands = [delegateCommand()];

        const result = await resolveCantonRefreshPlan({
            unresolvedCommands,
            unresolvedDisclosedContracts: [
                {
                    contractId: 'static',
                    templateId: 'pkg:Static',
                    createdEventBlob: 'static-blob',
                    synchronizerId: 'sync',
                },
                {
                    contractId: 'stale-rules',
                    templateId: 'pkg:ExternalPartyAmuletRules',
                    createdEventBlob: 'stale-rules-blob',
                    synchronizerId: 'sync',
                },
            ],
            refreshPlan: plan(),
            signingParties: [RICH],
            client,
        });

        const exercise = getExercise(result.commands[0]!);
        expect(exercise.contractId).toBe('fresh-executor');
        expect(exercise.choiceArgument).toMatchObject({
            amuletCids: ['amulet-4', 'amulet-3'],
            amuletContext: { values: { fresh: true } },
        });
        const args = exercise.choiceArgument as {
            timestamp: string;
            callArgs: Array<[string, { tag: string; value: string }]>;
        };
        expect(args.callArgs[0]![1]).toEqual({
            tag: 'AV_Time',
            value: args.timestamp,
        });
        expect(result.disclosedContracts.map(({ contractId }) => contractId)).toEqual([
            'static',
            'stale-rules',
            'fresh-rules',
        ]);
        expect(client.getLedgerEndOffset).toHaveBeenCalledTimes(2);
        expect(queryActiveContracts).toHaveBeenCalledTimes(2);
        expect(queryActiveContracts).toHaveBeenCalledWith(
            RICH,
            42,
            expect.objectContaining({ includeCreatedEventBlob: true }),
        );
        expect(getExercise(unresolvedCommands[0]!).contractId).toBe('stale-executor');
    });

    it('retains a stale disclosure alongside the coherent ACS disclosure', async () => {
        const fresh = activeContract({
            contractId: 'fresh-config',
            templateId: 'pkg:Config:Config',
            createArgument: { owner: RICH },
            signatories: [RICH],
            observers: [INFORMEE],
            blob: 'fresh-blob',
        });
        const client = {
            getLedgerEndOffset: vi.fn(async () => 9),
            queryActiveContracts: vi.fn(async () => [fresh]),
        } as unknown as ICantonClient;
        const command = delegateCommand();
        (command.exerciseCommand.choiceArgument as Record<string, unknown>).configCid =
            'stale-config';

        const result = await resolveCantonRefreshPlan({
            unresolvedCommands: [command],
            unresolvedDisclosedContracts: [
                {
                    contractId: 'stale-config',
                    templateId: 'pkg:Config:Config',
                    createdEventBlob: 'stale-blob',
                    synchronizerId: 'sync',
                },
            ],
            refreshPlan: {
                commands: [
                    {
                        resolver: {
                            type: 'activeContract',
                            selector: {
                                queryAs: { party: INFORMEE },
                                templateId: '#package:Config:Config',
                                expectedSignatories: [RICH],
                            },
                            selection: { kind: 'exactlyOne' },
                        },
                        targets: [
                            {
                                commandIndex: 0,
                                command: 'exercise',
                                choice: 'DelegateLzReceive',
                                arguments: [{ path: [{ field: 'configCid' }] }],
                            },
                        ],
                    },
                ],
            },
            signingParties: ['different-signer'],
            client,
        });

        expect(result.disclosedContracts).toEqual([
            {
                contractId: 'stale-config',
                templateId: 'pkg:Config:Config',
                createdEventBlob: 'stale-blob',
                synchronizerId: 'sync',
            },
            {
                contractId: 'fresh-config',
                templateId: 'pkg:Config:Config',
                createdEventBlob: 'fresh-blob',
                synchronizerId: 'sync',
            },
        ]);
    });

    it('does not mutate unresolved commands when a later target is invalid', async () => {
        const command = delegateCommand();
        const client = {
            getLedgerEndOffset: vi.fn(async () => 1),
            getAmuletContextWithExternalRules: vi.fn(async () => ({
                amuletContext: { values: { fresh: true } },
                externalPartyAmuletRulesCid: 'rules',
                disclosedContracts: [],
            })),
        } as unknown as ICantonClient;

        await expect(
            resolveCantonRefreshPlan({
                unresolvedCommands: [command],
                unresolvedDisclosedContracts: [],
                refreshPlan: {
                    commands: [
                        {
                            resolver: { type: 'timestamp' },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'DelegateLzReceive',
                                    arguments: [{ path: [{ field: 'timestamp' }] }],
                                },
                            ],
                        },
                        {
                            resolver: { type: 'amuletContext', dsoParty: DSO },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'WrongChoice',
                                    arguments: [{ path: [{ field: 'amuletContext' }] }],
                                },
                            ],
                        },
                    ],
                },
                signingParties: [RICH],
                client,
            }),
        ).rejects.toThrow(expect.objectContaining({ constructor: Error }));
        expect(command.exerciseCommand.choiceArgument).toMatchObject({
            timestamp: '2020-01-01T00:00:00.000Z',
            amuletContext: { values: { stale: true } },
        });
    });

    it('rejects mixing a refresh plan with legacy sentinels', async () => {
        const command = delegateCommand();
        command.exerciseCommand.contractId = cantonActiveContractIdRef({
            partyToFilter: { party: RICH },
            expectedSignatories: [RICH],
            templateId: '#package:Executor:Executor',
        });

        await expect(
            resolveCantonRefreshPlan({
                unresolvedCommands: [command],
                unresolvedDisclosedContracts: [],
                refreshPlan: plan(),
                signingParties: [RICH],
                client: {
                    getLedgerEndOffset: vi.fn(async () => 1),
                } as unknown as ICantonClient,
            }),
        ).rejects.toThrow(/cannot be combined/);
    });
});

describe('Amulet context contract ID targets', () => {
    const contextTarget = {
        commandIndex: 0,
        command: 'exercise' as const,
        choice: 'DelegateLzReceive',
        arguments: [{ path: [{ field: 'amuletContext' }] }],
    };

    it.each([
        { contractIdTargets: [] },
        { contractIdTargets: [{ commandIndex: -1, command: 'exercise', field: 'contractId' }] },
        { contractIdTargets: [{ commandIndex: 0, command: 'create', field: 'contractId' }] },
        { contractIdTargets: [{ commandIndex: 0, command: 'exercise', field: 'choiceArgument' }] },
        { contractIdTargets: [contextTarget] },
    ])('rejects invalid contract ID targets $contractIdTargets', ({ contractIdTargets }) => {
        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: { type: 'amuletContext', dsoParty: DSO },
                        targets: [contextTarget],
                        contractIdTargets,
                    },
                ],
            }).success,
        ).toBe(false);
    });

    it('still requires context targets when contract ID targets are present', () => {
        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: { type: 'amuletContext', dsoParty: DSO },
                        targets: [],
                        contractIdTargets: [
                            { commandIndex: 0, command: 'exercise', field: 'contractId' },
                        ],
                    },
                ],
            }).success,
        ).toBe(false);
    });

    it.each([
        { commandIndex: 1, error: 'is not an exercise' },
        { commandIndex: 2, error: 'does not exist' },
    ])(
        'guards contract ID target index $commandIndex without mutating inputs',
        async ({ commandIndex, error }) => {
            const commands = [delegateCommand(), timedCreateCommand()];
            const baseline = structuredClone(commands);
            const getAmuletContextWithExternalRules = vi.fn(async () => ({
                amuletContext: { values: { fresh: true } },
                externalPartyAmuletRulesCid: 'fresh-rules',
                disclosedContracts: [],
            }));

            await expect(
                resolveCantonRefreshPlan({
                    unresolvedCommands: commands,
                    unresolvedDisclosedContracts: [],
                    refreshPlan: {
                        commands: [
                            {
                                resolver: { type: 'amuletContext', dsoParty: DSO },
                                targets: [contextTarget],
                                contractIdTargets: [
                                    { commandIndex, command: 'exercise', field: 'contractId' },
                                ],
                            },
                        ],
                    },
                    signingParties: [RICH],
                    client: { getAmuletContextWithExternalRules } as unknown as ICantonClient,
                }),
            ).rejects.toThrow(error);

            expect(commands).toEqual(baseline);
            expect(getAmuletContextWithExternalRules).toHaveBeenCalledOnce();
        },
    );
});

describe('Amulet context probe', () => {
    afterEach(() => vi.unstubAllGlobals());

    const resolveWithWallet = async (resolver: Record<string, unknown>) => {
        const fetch = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choiceContext: {
                            choiceContextData: { values: {} },
                            disclosedContracts: [
                                {
                                    templateId:
                                        'pkg:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules',
                                    contractId: 'rules',
                                    createdEventBlob: 'blob',
                                    synchronizerId: 'sync',
                                },
                            ],
                        },
                    }),
                ),
        );
        vi.stubGlobal('fetch', fetch);
        const refreshPlan = cantonRefreshPlanSchema.parse(
            JSON.parse(
                JSON.stringify({
                    commands: [
                        {
                            resolver,
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'DelegateLzReceive',
                                    arguments: [{ path: [{ field: 'amuletContext' }] }],
                                },
                            ],
                        },
                    ],
                }),
            ),
        );

        await resolveCantonRefreshPlan({
            unresolvedCommands: [delegateCommand()],
            unresolvedDisclosedContracts: [],
            refreshPlan,
            signingParties: [RICH],
            client: new CantonClient(new Configuration(), 'user', {
                walletUrl: 'https://wallet.example',
                tokenProvider: { getToken: async () => 'token' },
            }),
        });

        const [, options] = fetch.mock.calls[0] as unknown as [URL, { body: string }];
        return JSON.parse(options.body).choiceArguments.transfer;
    };

    it('probes a zero-amount admin self-transfer for a resolver without a receiver or amount', async () => {
        expect(await resolveWithWallet({ type: 'amuletContext', dsoParty: DSO })).toMatchObject({
            sender: DSO,
            receiver: DSO,
            amount: '0',
        });
    });

    it('probes the serialized receiver and amount', async () => {
        expect(
            await resolveWithWallet({
                type: 'amuletContext',
                dsoParty: DSO,
                receiver: INFORMEE,
                amount: '2.5',
            }),
        ).toMatchObject({ sender: DSO, receiver: INFORMEE, amount: '2.5' });
    });
});

describe('expired TransferPreapproval fallback', () => {
    const NOW = '2026-11-02T12:00:00.000Z';
    const PREAPPROVAL_CONTEXT = {
        'transfer-preapproval': { tag: 'AV_ContractId', value: 'preapproval' },
    };
    const BUILD_PREAPPROVAL_CONTEXT = {
        'transfer-preapproval': { tag: 'AV_ContractId', value: 'build-preapproval' },
    };
    const rulesDisclosure: CantonDisclosedContract = {
        templateId: 'pkg:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules',
        contractId: 'rules',
        createdEventBlob: 'rules-blob',
        synchronizerId: 'sync',
    };
    const preapprovalDisclosure = (debugPayload?: unknown): CantonDisclosedContract => ({
        templateId: 'pkg:Splice.AmuletRules:TransferPreapproval',
        contractId: 'preapproval',
        createdEventBlob: 'preapproval-blob',
        synchronizerId: 'sync',
        ...(debugPayload === undefined ? {} : { debugPayload }),
    });
    const expiringAt = (expiresAt: unknown) =>
        preapprovalDisclosure({ dso: DSO, receiver: INFORMEE, provider: RICH, expiresAt });
    const minutesFromNow = (minutes: number) =>
        new Date(Date.parse(NOW) + minutes * 60 * 1000).toISOString();

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const resolveForReceiver = async (...receiverDisclosures: CantonDisclosedContract[]) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(NOW));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetch = vi.fn(async (_url: URL, init: { body: string }) => {
            const { receiver } = JSON.parse(init.body).choiceArguments.transfer;
            const forReceiver = receiver === INFORMEE;
            return new Response(
                JSON.stringify({
                    choiceContext: {
                        choiceContextData: {
                            values: {
                                probe: forReceiver ? 'receiver' : 'generic',
                                ...(forReceiver && receiverDisclosures.length > 0
                                    ? PREAPPROVAL_CONTEXT
                                    : {}),
                            },
                        },
                        disclosedContracts: [
                            rulesDisclosure,
                            ...(forReceiver ? receiverDisclosures : []),
                        ],
                    },
                }),
            );
        });
        vi.stubGlobal('fetch', fetch);
        const command = delegateCommand();
        command.exerciseCommand.choiceArgument = {
            ...(command.exerciseCommand.choiceArgument as Record<string, unknown>),
            amuletContext: { values: { probe: 'build', ...BUILD_PREAPPROVAL_CONTEXT } },
        };

        const result = await resolveCantonRefreshPlan({
            unresolvedCommands: [command],
            unresolvedDisclosedContracts: [
                {
                    ...preapprovalDisclosure(),
                    contractId: 'build-preapproval',
                    createdEventBlob: 'build-preapproval-blob',
                },
            ],
            refreshPlan: {
                commands: [
                    {
                        resolver: {
                            type: 'amuletContext',
                            dsoParty: DSO,
                            receiver: INFORMEE,
                            amount: '2.5',
                        },
                        targets: [
                            {
                                commandIndex: 0,
                                command: 'exercise',
                                choice: 'DelegateLzReceive',
                                arguments: [{ path: [{ field: 'amuletContext' }] }],
                            },
                        ],
                    },
                ],
            },
            signingParties: [RICH],
            client: new CantonClient(new Configuration(), 'user', {
                walletUrl: 'https://wallet.example',
                tokenProvider: { getToken: async () => 'token' },
            }),
        });

        return {
            context: (getExercise(result.commands[0]!).choiceArgument as Record<string, unknown>)
                .amuletContext,
            disclosedContractIds: result.disclosedContracts.map(({ contractId }) => contractId),
            probes: fetch.mock.calls.map(([, init]) => {
                const { receiver, amount } = JSON.parse(init.body).choiceArguments.transfer;
                return { receiver, amount };
            }),
            warn,
        };
    };

    const genericContext = {
        values: {
            probe: 'generic',
            'external-party-amulet-rules': { tag: 'AV_ContractId', value: 'rules' },
        },
    };
    const receiverContext = {
        values: {
            probe: 'receiver',
            ...PREAPPROVAL_CONTEXT,
            'external-party-amulet-rules': { tag: 'AV_ContractId', value: 'rules' },
        },
    };

    it.each([
        { case: 'past', expiresAt: minutesFromNow(-1) },
        { case: 'within the margin', expiresAt: minutesFromNow(4) },
        { case: 'at the margin', expiresAt: minutesFromNow(5) },
        { case: 'with microsecond precision', expiresAt: '2026-11-02T12:04:59.123456Z' },
    ])(
        'refetches the generic context when the preapproval expiry is $case',
        async ({ expiresAt }) => {
            const { context, disclosedContractIds, probes, warn } = await resolveForReceiver(
                expiringAt(expiresAt),
            );

            expect(probes).toEqual([
                { receiver: INFORMEE, amount: '2.5' },
                { receiver: DSO, amount: '0' },
            ]);
            expect(context).toEqual(genericContext);
            expect(disclosedContractIds).toEqual(['build-preapproval', 'rules']);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining(INFORMEE));
            expect(warn).toHaveBeenCalledWith(expect.stringContaining(expiresAt));
        },
    );

    it.each([
        { case: 'expires after the margin', disclosure: expiringAt(minutesFromNow(6)) },
        { case: 'has no debugPayload', disclosure: preapprovalDisclosure() },
        {
            case: 'has no expiresAt',
            disclosure: preapprovalDisclosure({ dso: DSO, receiver: INFORMEE }),
        },
        { case: 'has a non-Time expiresAt', disclosure: expiringAt('soon') },
        { case: 'has a date-only expiresAt', disclosure: expiringAt('2026-11-02') },
        { case: 'has a numeric expiresAt', disclosure: expiringAt(Date.parse(NOW)) },
    ])('keeps the receiver context when the preapproval $case', async ({ disclosure }) => {
        const { context, probes, warn } = await resolveForReceiver(disclosure);

        expect(probes).toEqual([{ receiver: INFORMEE, amount: '2.5' }]);
        expect(context).toEqual(receiverContext);
        expect(warn).not.toHaveBeenCalled();
    });

    it.each([
        {
            case: 'an unrelated disclosure listed first has expired',
            disclosures: [
                {
                    ...expiringAt(minutesFromNow(-1)),
                    contractId: 'other-preapproval',
                    createdEventBlob: 'other-preapproval-blob',
                },
                expiringAt(minutesFromNow(6)),
            ],
        },
        {
            case: 'only a disclosure with another contract ID has expired',
            disclosures: [
                {
                    ...expiringAt(minutesFromNow(-1)),
                    contractId: 'other-preapproval',
                    createdEventBlob: 'other-preapproval-blob',
                },
            ],
        },
    ])('keeps the receiver context when $case', async ({ disclosures }) => {
        const { context, probes, warn } = await resolveForReceiver(...disclosures);

        expect(probes).toEqual([{ receiver: INFORMEE, amount: '2.5' }]);
        expect(context).toEqual(receiverContext);
        expect(warn).not.toHaveBeenCalled();
    });

    it('keeps the receiver context when it carries no preapproval', async () => {
        const { context, probes, warn } = await resolveForReceiver();

        expect(probes).toEqual([{ receiver: INFORMEE, amount: '2.5' }]);
        expect(context).toEqual({
            values: {
                probe: 'receiver',
                'external-party-amulet-rules': { tag: 'AV_ContractId', value: 'rules' },
            },
        });
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('refresh disclosure merging', () => {
    const disclosure = (contractId: string): CantonDisclosedContract => ({
        contractId,
        templateId: 'pkg:ExternalPartyAmuletRules:ExternalPartyAmuletRules',
        createdEventBlob: `blob-${contractId}`,
        synchronizerId: 'sync',
    });
    const bundle = (disclosedContracts: CantonDisclosedContract[]) => ({
        amuletContext: { values: { rulesCid: disclosedContracts[0]?.contractId ?? '' } },
        externalPartyAmuletRulesCid: disclosedContracts[0]?.contractId ?? '',
        disclosedContracts,
    });
    const setup = (
        unresolvedDisclosedContracts: CantonDisclosedContract[],
        freshDisclosures: CantonDisclosedContract[],
    ) => {
        const getAmuletContextWithExternalRules = vi.fn(async () => bundle(freshDisclosures));
        return {
            getAmuletContextWithExternalRules,
            args: {
                unresolvedCommands: [delegateCommand()],
                unresolvedDisclosedContracts,
                refreshPlan: {
                    commands: [
                        {
                            resolver: { type: 'amuletContext', dsoParty: DSO },
                            targets: [
                                {
                                    commandIndex: 0,
                                    command: 'exercise',
                                    choice: 'DelegateLzReceive',
                                    arguments: [{ path: [{ field: 'amuletContext' }] }],
                                },
                            ],
                        },
                    ],
                } satisfies CantonRefreshPlan,
                signingParties: [RICH],
                client: { getAmuletContextWithExternalRules } as unknown as ICantonClient,
            },
        };
    };

    it('deduplicates identical disclosures within and across the baseline and resolver results', async () => {
        const original = disclosure('original');
        const fresh = disclosure('fresh');
        const { args } = setup([original, { ...original }], [{ ...original }, fresh, { ...fresh }]);

        const result = await resolveCantonRefreshPlan(args);

        expect(result.disclosedContracts).toEqual([original, fresh]);
    });

    it.each(['templateId', 'createdEventBlob', 'synchronizerId'] as const)(
        'rejects a resolver disclosure whose %s conflicts with the baseline',
        async (field) => {
            const original = disclosure('rules');
            const { args } = setup([original], [{ ...original, [field]: 'conflicting' }]);

            await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
                'Conflicting disclosures for contract rules',
            );
        },
    );

    it.each(['baseline', 'resolver'] as const)(
        'rejects conflicting disclosures within the %s',
        async (source) => {
            const original = disclosure('rules');
            const conflicts = [original, { ...original, createdEventBlob: 'conflicting' }];
            const { args } = setup(
                source === 'baseline' ? conflicts : [],
                source === 'resolver' ? conflicts : [],
            );

            await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
                'Conflicting disclosures for contract rules',
            );
        },
    );

    it('rebuilds from the original inputs without accumulating previous resolution results', async () => {
        const original = disclosure('rules-v1');
        const firstFresh = disclosure('rules-v2');
        const nextFresh = disclosure('rules-v3');
        const { args, getAmuletContextWithExternalRules } = setup([original], [firstFresh]);
        const baseline = structuredClone({
            commands: args.unresolvedCommands,
            disclosedContracts: args.unresolvedDisclosedContracts,
            refreshPlan: args.refreshPlan,
        });

        const first = await resolveCantonRefreshPlan(args);
        getAmuletContextWithExternalRules.mockResolvedValue(bundle([nextFresh]));
        const rebuilt = await resolveCantonRefreshPlan(args);

        expect(first.disclosedContracts).toEqual([original, firstFresh]);
        expect(rebuilt.disclosedContracts).toEqual([original, nextFresh]);
        expect(getExercise(first.commands[0]!).choiceArgument).toMatchObject({
            amuletContext: bundle([firstFresh]).amuletContext,
        });
        expect(getExercise(rebuilt.commands[0]!).choiceArgument).toMatchObject({
            amuletContext: bundle([nextFresh]).amuletContext,
        });
        expect(args.unresolvedCommands).toEqual(baseline.commands);
        expect(args.unresolvedDisclosedContracts).toEqual(baseline.disclosedContracts);
        expect(args.refreshPlan).toEqual(baseline.refreshPlan);
        expect(getAmuletContextWithExternalRules).toHaveBeenCalledTimes(2);
    });
});

describe('selectContractsByGte', () => {
    it('selects deterministically until the requested field value is covered', () => {
        expect(
            selectContractsByGte(
                [amulet('cid-b', '2.0'), amulet('cid-a', '2.0'), amulet('cid-c', '4.0')],
                'amount',
                '5.0',
            ).map(({ createdEvent }) => createdEvent.contractId),
        ).toEqual(['cid-c', 'cid-a']);
    });

    it('fails when the combined balance is insufficient', () => {
        expect(() => selectContractsByGte([amulet('cid-a', '1.0')], 'amount', '2.0')).toThrow(
            /Insufficient contract value/,
        );
    });

    it('supports a different numeric create-argument field', () => {
        const credit = activeContract({
            contractId: 'credit-cid',
            templateId: 'pkg:Asset:Credit',
            createArgument: { availableCredit: '3.0' },
            signatories: [RICH],
        });
        expect(
            selectContractsByGte([credit], 'availableCredit', '2.0').map(
                ({ createdEvent }) => createdEvent.contractId,
            ),
        ).toEqual(['credit-cid']);
    });
});

describe('correlated active contract values', () => {
    const selector = {
        queryAs: { party: INFORMEE },
        templateId: '#config:Config:Config',
        expectedSignatories: [INFORMEE],
        stateFilter: { handler: INFORMEE },
    };
    const target = (field: string) => ({
        commandIndex: 0,
        command: 'exercise' as const,
        choice: 'Request_Create',
        arguments: [{ path: [{ field }] }],
    });
    const refreshPlan: CantonRefreshPlan = {
        commands: [
            {
                resolver: {
                    type: 'activeContract',
                    selector,
                    selection: { kind: 'exactlyOne' },
                },
                targets: [target('ownerConfig')],
            },
            {
                resolver: { type: 'activeContractValue', selector, field: 'minFee' },
                targets: [target('feeAmount')],
            },
            {
                resolver: {
                    type: 'activeContract',
                    selector: {
                        queryAs: { party: RICH },
                        templateId: '#splice-amulet:Splice.Amulet:Amulet',
                        expectedSignatories: [DSO],
                        stateFilter: { owner: RICH },
                    },
                    selection: {
                        kind: 'gte',
                        field: 'amount',
                        value: { selector, field: 'minFee' },
                    },
                },
                targets: [target('amuletCids')],
            },
        ],
    };
    const config = (contractId: string, minFee: unknown, signatories = [INFORMEE]) =>
        activeContract({
            contractId,
            templateId: 'pkg:Config:Config',
            createArgument: { handler: INFORMEE, minFee },
            signatories,
        });
    const setup = (configs: JsActiveContract[]) => {
        const queryActiveContracts = vi.fn(async (party: string) =>
            party === INFORMEE ? configs : [amulet('a', '3.0'), amulet('b', '2.0')],
        );
        const baseline: CantonUnresolvedCommand[] = [
            {
                exerciseCommand: {
                    templateId: 'pkg:Factory:Factory',
                    contractId: 'factory',
                    choice: 'Request_Create',
                    choiceArgument: {
                        ownerConfig: 'old-config',
                        feeAmount: '1.0',
                        amuletCids: ['old'],
                    },
                },
            },
        ];
        const args = {
            unresolvedCommands: baseline,
            unresolvedDisclosedContracts: [
                {
                    contractId: 'old-config',
                    templateId: 'pkg:Config:Config',
                    createdEventBlob: 'old-blob',
                    synchronizerId: 'sync',
                },
            ],
            refreshPlan: cantonRefreshPlanSchema.parse(JSON.parse(JSON.stringify(refreshPlan))),
            signingParties: [RICH],
            client: {
                getLedgerEndOffset: vi.fn(async () => 1),
                queryActiveContracts,
            } as unknown as ICantonClient,
        };
        return { args, baseline, queryActiveContracts };
    };

    it('shares one authenticated config snapshot for CID, fee and funding on each resolution', async () => {
        const configs = [config('spoof', '99', ['attacker']), config('config-1', '4.0')];
        const { args, baseline, queryActiveContracts } = setup(configs);
        const original = structuredClone(baseline);
        const first = await resolveCantonRefreshPlan(args);
        expect(getExercise(first.commands[0]!).choiceArgument).toEqual({
            ownerConfig: 'config-1',
            feeAmount: '4.0',
            amuletCids: ['a', 'b'],
        });
        expect(
            queryActiveContracts.mock.calls.filter(([party]) => party === INFORMEE),
        ).toHaveLength(1);
        expect(first.disclosedContracts.map(({ contractId }) => contractId)).toEqual([
            'old-config',
            'config-1',
        ]);
        configs.splice(0, configs.length, config('config-2', '2.0'));
        const second = await resolveCantonRefreshPlan(args);
        expect(getExercise(second.commands[0]!).choiceArgument).toEqual({
            ownerConfig: 'config-2',
            feeAmount: '2.0',
            amuletCids: ['a'],
        });
        expect(second.disclosedContracts.map(({ contractId }) => contractId)).toEqual([
            'old-config',
            'config-2',
        ]);
        expect(baseline).toEqual(original);
    });

    it.each([undefined, 1, 'bad', '0', '-1', '0.00000000001'])(
        'rejects invalid config amount %s',
        async (fee) => {
            const { args } = setup([config('config', fee)]);
            await expect(resolveCantonRefreshPlan(args)).rejects.toThrow(
                expect.objectContaining({ constructor: Error }),
            );
        },
    );

    it('rejects ambiguous authenticated config matches', async () => {
        const { args } = setup([config('one', '1'), config('two', '2')]);
        args.refreshPlan.commands = [args.refreshPlan.commands[1]!];
        await expect(resolveCantonRefreshPlan(args)).rejects.toThrow('expected exactly one');
    });

    it('validates a dynamic funding threshold without requiring a projection entry', async () => {
        const { args } = setup([config('one', '0')]);
        args.refreshPlan.commands = [args.refreshPlan.commands[2]!];
        await expect(resolveCantonRefreshPlan(args)).rejects.toThrow('must be positive');
    });

    it('does not allow numeric projections to target an exercise contract ID', () => {
        expect(
            cantonRefreshPlanSchema.safeParse({
                commands: [
                    {
                        resolver: { type: 'activeContractValue', selector, field: 'minFee' },
                        targets: [{ commandIndex: 0, command: 'exercise', field: 'contractId' }],
                    },
                ],
            }).success,
        ).toBe(false);
    });
});

describe('interface and linked contract selectors', () => {
    const interfaceId = '#custom:IOAppConfig:IOAppConfig';
    const selector = {
        queryAs: { party: INFORMEE },
        interfaceId,
        expectedSignatories: ['admin'],
        stateFilter: { 'oappId.admin': 'admin', 'oappId.id': 'app' },
    };
    const config = () => ({
        ...activeContract({
            contractId: 'config',
            templateId: 'pkg:Custom:Custom',
            createArgument: { factoryCid: 'factory' },
            signatories: ['admin'],
        }),
        createdEvent: {
            ...activeContract({
                contractId: 'config',
                templateId: 'pkg:Custom:Custom',
                createArgument: { factoryCid: 'factory' },
                signatories: ['admin'],
            }).createdEvent,
            interfaceViews: [
                {
                    interfaceId: 'pkg:IOAppConfig:IOAppConfig',
                    viewStatus: { code: 0, message: '' },
                    viewValue: { oappId: { id: 'app', admin: 'admin' } },
                },
            ],
        },
    });
    const linkedPlan: CantonRefreshPlan = {
        commands: [
            {
                resolver: { type: 'activeContract', selector, selection: { kind: 'exactlyOne' } },
                targets: [],
            },
            {
                resolver: {
                    type: 'activeContract',
                    selector: {
                        queryAs: { party: INFORMEE },
                        templateId: 'pkg:Factory:Factory',
                        expectedSignatories: [INFORMEE],
                        contractId: { selector, field: 'factoryCid' },
                    },
                    selection: { kind: 'exactlyOne' },
                },
                targets: [],
            },
        ],
    };
    const resolve = (configs: JsActiveContract[], factoryCid = 'factory') => {
        const queryActiveContractsByInterface = vi.fn(async () => configs);
        const client = {
            getLedgerEndOffset: vi.fn(async () => 1),
            getPackageId: vi.fn(async () => 'pkg'),
            queryActiveContractsByInterface,
            queryActiveContracts: vi.fn(async () => [
                activeContract({
                    contractId: factoryCid,
                    templateId: 'pkg:Factory:Factory',
                    createArgument: {},
                    signatories: [INFORMEE],
                }),
            ]),
        } as unknown as ICantonClient;
        return {
            queryActiveContractsByInterface,
            result: resolveCantonRefreshPlan({
                unresolvedCommands: [],
                unresolvedDisclosedContracts: [],
                refreshPlan: linkedPlan,
                signingParties: [RICH],
                client,
            }),
        };
    };
    it('uses a single authenticated interface snapshot for config and linked factory disclosure', async () => {
        const spoof = config();
        spoof.createdEvent.signatories = ['attacker'];
        const { result, queryActiveContractsByInterface } = resolve([spoof, config()]);
        expect((await result).disclosedContracts.map((d) => d.contractId)).toEqual([
            'config',
            'factory',
        ]);
        expect(queryActiveContractsByInterface).toHaveBeenCalledTimes(1);
        expect(queryActiveContractsByInterface).toHaveBeenCalledWith([INFORMEE], 1, [interfaceId], {
            includeCreatedEventBlob: true,
        });
        expect(cantonRefreshPlanSchema.safeParse(linkedPlan).success).toBe(true);
    });
    it('rejects a stale config reference instead of disclosing an unrelated current factory', async () => {
        await expect(resolve([config()], 'other-factory').result).rejects.toThrow(
            'matched 0 contracts',
        );
    });
    it.each([
        'missing',
        'failed',
        'wrong',
        'duplicate',
        'spoof',
        'wrong-package',
        'failed-duplicate',
    ] as const)('rejects %s interface views', async (mode) => {
        const candidate = config();
        if (mode === 'missing') candidate.createdEvent.interfaceViews = [];
        if (mode === 'failed')
            candidate.createdEvent.interfaceViews![0]!.viewStatus = {
                code: 5,
                message: 'failed',
            };
        if (mode === 'wrong')
            candidate.createdEvent.interfaceViews![0]!.interfaceId = 'pkg:Other:Other';
        if (mode === 'duplicate')
            candidate.createdEvent.interfaceViews!.push(candidate.createdEvent.interfaceViews![0]!);
        if (mode === 'spoof') candidate.createdEvent.signatories = ['attacker'];
        if (mode === 'wrong-package')
            candidate.createdEvent.interfaceViews![0]!.interfaceId =
                'unrelated:IOAppConfig:IOAppConfig';
        if (mode === 'failed-duplicate')
            candidate.createdEvent.interfaceViews!.push({
                ...candidate.createdEvent.interfaceViews![0]!,
                viewStatus: { code: 13, message: 'failed' },
            });
        await expect(resolve([candidate]).result).rejects.toThrow('no matching active contracts');
    });
    it('rejects ambiguous authenticated sources and malformed linked CIDs', async () => {
        await expect(resolve([config(), config()]).result).rejects.toThrow('expected exactly one');
        const candidate = config();
        candidate.createdEvent.createArgument = { factoryCid: '' };
        await expect(resolve([candidate]).result).rejects.toThrow('nonempty contract ID');
    });
    it('rejects selectors specifying both a template and interface', () => {
        const invalid = structuredClone(linkedPlan);
        Object.assign(invalid.commands[0]!.resolver, {
            selector: { ...selector, templateId: 'pkg:T:T' },
        });
        expect(cantonRefreshPlanSchema.safeParse(invalid).success).toBe(false);
    });
});

describe('exercise entrypoint choice guard', () => {
    it.each([undefined, 'DelegateLzReceive', 'OtherChoice'])(
        'honors optional choice %s after serialization',
        async (choice) => {
            const plan = cantonRefreshPlanSchema.parse(
                JSON.parse(
                    JSON.stringify({
                        commands: [
                            {
                                resolver: {
                                    type: 'activeContract',
                                    selector: {
                                        queryAs: { party: RICH },
                                        templateId: 'pkg:Executor:Executor',
                                        expectedSignatories: [RICH],
                                    },
                                    selection: { kind: 'exactlyOne' },
                                },
                                targets: [
                                    {
                                        commandIndex: 0,
                                        command: 'exercise',
                                        field: 'contractId',
                                        ...(choice ? { choice } : {}),
                                    },
                                ],
                            },
                        ],
                    }),
                ),
            );
            const commands = [delegateCommand()];
            const result = resolveCantonRefreshPlan({
                unresolvedCommands: commands,
                unresolvedDisclosedContracts: [],
                refreshPlan: plan,
                signingParties: [RICH],
                client: {
                    getLedgerEndOffset: vi.fn(async () => 1),
                    queryActiveContracts: vi.fn(async () => [
                        activeContract({
                            contractId: 'fresh',
                            templateId: 'pkg:Executor:Executor',
                            createArgument: {},
                            signatories: [RICH],
                        }),
                    ]),
                } as unknown as ICantonClient,
            });
            if (choice === 'OtherChoice') {
                await expect(result).rejects.toThrow(
                    'expected choice OtherChoice, found DelegateLzReceive',
                );
            } else {
                expect((await result).commands).toEqual([
                    { exerciseCommand: { ...commands[0]!.exerciseCommand, contractId: 'fresh' } },
                ]);
            }
            expect(commands[0]!.exerciseCommand.contractId).toBe('stale-executor');
        },
    );
});
