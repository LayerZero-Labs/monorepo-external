import { z } from 'zod';

import { cantonExpectedSignatoriesSchema, cantonRefreshPartyFilterSchema } from '../deferredValue';

export const cantonRefreshPathSegmentSchema = z.union([
    z.object({ field: z.string().min(1) }),
    z.object({ index: z.number().int().nonnegative() }),
    z.object({ damlMapKey: z.string().min(1) }),
]);

export const cantonRefreshPathSchema = z.array(cantonRefreshPathSegmentSchema);
const cantonNestedRefreshPathSchema = cantonRefreshPathSchema.min(1);

const exerciseEntrypointTargetSchema = z.object({
    commandIndex: z.number().int().nonnegative(),
    command: z.literal('exercise'),
    field: z.literal('contractId'),
    choice: z.string().min(1).optional(),
});

const exerciseChoiceArgumentTargetSchema = z.object({
    commandIndex: z.number().int().nonnegative(),
    command: z.literal('exercise'),
    choice: z.string().min(1),
    arguments: z
        .array(
            z.object({
                path: cantonRefreshPathSchema,
            }),
        )
        .min(1),
});

const cantonCreateArgumentTargetSchema = z.object({
    commandIndex: z.number().int().nonnegative(),
    command: z.literal('create'),
    template: z.string().min(1),
    arguments: z
        .array(
            z.object({
                path: cantonRefreshPathSchema,
            }),
        )
        .min(1),
});

export const cantonRefreshTargetSchema = z.union([
    exerciseEntrypointTargetSchema,
    exerciseChoiceArgumentTargetSchema,
    cantonCreateArgumentTargetSchema,
]);

export const cantonArgumentRefreshTargetSchema = z.union([
    exerciseChoiceArgumentTargetSchema,
    cantonCreateArgumentTargetSchema,
]);

const cantonNestedArgumentRefreshTargetSchema = z.union([
    exerciseChoiceArgumentTargetSchema.extend({
        arguments: z
            .array(
                z.object({
                    path: cantonNestedRefreshPathSchema,
                    offsetMs: z.number().int().optional(),
                }),
            )
            .min(1),
    }),
    cantonCreateArgumentTargetSchema.extend({
        arguments: z
            .array(
                z.object({
                    path: cantonNestedRefreshPathSchema,
                    offsetMs: z.number().int().optional(),
                }),
            )
            .min(1),
    }),
]);

const cantonSelectorFields = {
    queryAs: cantonRefreshPartyFilterSchema,
    expectedSignatories: cantonExpectedSignatoriesSchema,
    stateFilter: z.record(z.string(), z.unknown()).optional(),
};
const cantonBaseContractSelectorSchema = z.union([
    z.object({
        ...cantonSelectorFields,
        templateId: z.string().min(1),
        interfaceId: z.never().optional(),
    }),
    z.object({
        ...cantonSelectorFields,
        interfaceId: z.string().min(1),
        templateId: z.never().optional(),
    }),
]);
const cantonContractSelectorSchema = cantonBaseContractSelectorSchema.and(
    z.object({
        contractId: z
            .object({ selector: cantonBaseContractSelectorSchema, field: z.string().min(1) })
            .optional(),
    }),
);

const cantonActiveContractValueSchema = z.object({
    selector: cantonContractSelectorSchema,
    field: z.string().min(1),
});

const cantonExactlyOneSelectionSchema = z.object({ kind: z.literal('exactlyOne') });
const cantonAllSelectionSchema = z.object({ kind: z.literal('all') });
const cantonGteSelectionSchema = z.object({
    kind: z.literal('gte'),
    field: z.string().min(1),
    value: z.union([z.string().min(1), cantonActiveContractValueSchema]),
});

export const cantonActiveContractSelectionSchema = z.discriminatedUnion('kind', [
    cantonExactlyOneSelectionSchema,
    cantonAllSelectionSchema,
    cantonGteSelectionSchema,
]);

const cantonActiveContractResolverFields = {
    type: z.literal('activeContract'),
    selector: cantonContractSelectorSchema,
};

const cantonActiveContractRefreshSchema = z.union([
    z.object({
        resolver: z.object({
            ...cantonActiveContractResolverFields,
            selection: cantonExactlyOneSelectionSchema,
        }),
        targets: z.array(cantonRefreshTargetSchema),
    }),
    z.object({
        resolver: z.object({
            ...cantonActiveContractResolverFields,
            selection: z.union([cantonAllSelectionSchema, cantonGteSelectionSchema]),
        }),
        targets: z.array(cantonArgumentRefreshTargetSchema).min(1),
    }),
]);

const cantonActiveContractValueRefreshSchema = z.object({
    resolver: cantonActiveContractValueSchema.extend({
        type: z.literal('activeContractValue'),
    }),
    targets: z.array(cantonArgumentRefreshTargetSchema).min(1),
});

const cantonAmuletContextRefreshSchema = z.object({
    resolver: z.object({
        type: z.literal('amuletContext'),
        dsoParty: z.string().min(1),
        // A transfer's receiver and amount, so the context includes the receiver's
        // TransferPreapproval. Omitted, the Wallet is probed with the admin and '0'.
        receiver: z.string().min(1).optional(),
        amount: z.string().min(1).optional(),
    }),
    targets: z.array(cantonArgumentRefreshTargetSchema).min(1),
    contractIdTargets: z.array(exerciseEntrypointTargetSchema).min(1).optional(),
});

export const cantonTransferInstructionAcceptContextRefreshSchema = z
    .object({
        resolver: z.object({
            type: z.literal('transferInstructionAcceptContext'),
            contractId: z.string().min(1),
        }),
        targets: z
            .array(
                z
                    .object({
                        commandIndex: z.number().int().nonnegative(),
                        command: z.literal('exercise'),
                        choice: z.literal('TransferInstruction_Accept'),
                        arguments: z
                            .array(
                                z
                                    .object({
                                        path: z.tuple([
                                            z.object({ field: z.literal('extraArgs') }).strict(),
                                            z.object({ field: z.literal('context') }).strict(),
                                        ]),
                                    })
                                    .strict(),
                            )
                            .min(1),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

const callbackArgumentTarget = <T extends 'executeContext' | 'callbackCid'>(field: T) =>
    z
        .object({
            commandIndex: z.number().int().nonnegative(),
            command: z.literal('exercise'),
            choice: z.literal('FinalizeCallback'),
            arguments: z.tuple([
                z
                    .object({
                        path: z.tuple([z.object({ field: z.literal(field) }).strict()]),
                    })
                    .strict(),
            ]),
        })
        .strict();

const callbackOAppIdSchema = z.object({ admin: z.string().min(1), id: z.string().min(1) }).strict();
const callbackDecimalSchema = z.string().regex(/^\d+$/);
const callbackIdentityFields = {
    instrumentId: callbackOAppIdSchema,
    localDecimals: callbackDecimalSchema,
    sharedDecimals: callbackDecimalSchema,
    rateLimiterScaleDecimals: callbackDecimalSchema,
};
export const cantonFinalizeCallbackRefreshSchema = z
    .object({
        resolver: z
            .object({
                type: z.literal('finalizeCallback'),
                pendingCallbackCid: z.string().min(1),
                informee: z.string().min(1),
                oappId: callbackOAppIdSchema,
                identity: z.discriminatedUnion('kind', [
                    z.object({ kind: z.literal('oft-self'), ...callbackIdentityFields }).strict(),
                    z
                        .object({
                            kind: z.literal('lock-unlock-adapter'),
                            ...callbackIdentityFields,
                            treasury: z.string().min(1),
                        })
                        .strict(),
                    z
                        .object({
                            kind: z.literal('burn-mint-adapter'),
                            ...callbackIdentityFields,
                            mintEscrow: z.string().min(1),
                        })
                        .strict(),
                ]),
                environment: z.string().optional(),
            })
            .strict(),
        targets: z.array(callbackArgumentTarget('executeContext')).min(1),
        callbackCidTargets: z.array(callbackArgumentTarget('callbackCid')).min(1),
    })
    .strict();

export type CantonFinalizeCallbackRefresh = z.infer<typeof cantonFinalizeCallbackRefreshSchema>;

const oneSigRequestIdentitySchema = z
    .object({ admin: z.string().min(1), id: z.string().min(1) })
    .strict();

// Extra parties the resolver also reads the ledger as; package lookups stay on `informee`.
const oneSigReadAsSchema = z.array(z.string().min(1)).min(1).optional();

export const cantonOneSigRequestContextRefreshSchema = z
    .object({
        resolver: z
            .object({
                type: z.literal('oneSigRequestContext'),
                informee: z.string().min(1),
                readAs: oneSigReadAsSchema,
                dsoParty: z.string().min(1),
                request: z.discriminatedUnion('kind', [
                    z
                        .object({
                            kind: z.literal('request'),
                            oneSig: z
                                .object({
                                    admin: z.string().min(1),
                                    oneSigId: z.string().regex(/^(0|[1-9]\d*)$/),
                                })
                                .strict(),
                        })
                        .strict(),
                    z
                        .object({
                            kind: z.enum(['oappRequest', 'oappAccept']),
                            oappId: oneSigRequestIdentitySchema,
                        })
                        .strict(),
                ]),
            })
            .strict(),
        targets: z
            .array(
                z
                    .object({
                        commandIndex: z.number().int().nonnegative(),
                        command: z.literal('exercise'),
                        choice: z.literal('OneSig_ExecuteTransaction'),
                        arguments: z.tuple([
                            z
                                .object({
                                    path: z.tuple([
                                        z.object({ field: z.literal('transaction') }).strict(),
                                        z.object({ field: z.literal('calls') }).strict(),
                                        z
                                            .object({ index: z.number().int().nonnegative() })
                                            .strict(),
                                        z.object({ field: z.literal('context') }).strict(),
                                    ]),
                                })
                                .strict(),
                        ]),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

export type CantonOneSigRequestContextRefresh = z.infer<
    typeof cantonOneSigRequestContextRefreshSchema
>;

const oneSigConfigResolverFields = {
    type: z.literal('oneSigConfigContext'),
    informee: z.string().min(1),
    readAs: oneSigReadAsSchema,
    oappId: oneSigRequestIdentitySchema,
};

export const cantonOneSigConfigContextRefreshSchema = z
    .object({
        resolver: z.discriminatedUnion('operation', [
            z
                .object({
                    ...oneSigConfigResolverFields,
                    operation: z.enum([
                        'OpAddToBlacklist',
                        'OpRemoveFromBlacklist',
                        'OpAddToWhitelist',
                        'OpRemoveFromWhitelist',
                        'OpSetAllowlistMode',
                        'OpRateLimiterSetDefault',
                        'OpRateLimiterSetEidOverride',
                        'OpRateLimiterRemoveEidOverride',
                        'OpRateLimiterSetGlobalFlags',
                        'OpRateLimiterSetAddressExemption',
                        'OpRateLimiterSetState',
                        'OpPauseLocalTransfers',
                        'OpUnpauseLocalTransfers',
                        'OpPauseDstEids',
                        'OpUnpauseDstEids',
                        'OpSetLedgerTimeValidityPeriod',
                        'OpSetPeer',
                        'OpSetFeeBps',
                        'OpSetFeeDeposit',
                        'OpSetEnforcedOptions',
                        'OpRemoveEnforcedOption',
                        'OpSetCostAsserts',
                        'OpRemoveCostAsserts',
                        'OpSetTransferRule',
                        'OpSetOfferExpiryDelayPeriod',
                        'OpSetObservers',
                    ]),
                })
                .strict(),
            z
                .object({
                    ...oneSigConfigResolverFields,
                    operation: z.literal('OpSetRequestFactory'),
                    expectedHandler: z.string().min(1),
                })
                .strict(),
        ]),
        targets: cantonOneSigRequestContextRefreshSchema.shape.targets,
    })
    .strict();

export type CantonOneSigConfigContextRefresh = z.infer<
    typeof cantonOneSigConfigContextRefreshSchema
>;

export const cantonOneSigScopeContextRefreshSchema = z
    .object({
        resolver: z
            .object({
                type: z.literal('oneSigScopeContext'),
                informee: z.string().min(1),
                readAs: oneSigReadAsSchema,
                operation: z.enum([
                    'OpGrantRoles',
                    'OpRevokeRoles',
                    'OpProposeDefaultAdmin',
                    'OpCancelProposeDefaultAdmin',
                    'OpAcceptDefaultAdmin',
                    'OpSetMinFee',
                    'OpSetMinPayoutValue',
                    'OpSetProtocolLedgerTimeValidityPeriod',
                ]),
                scope: z
                    .object({ category: z.string(), id: z.string(), admin: z.string().min(1) })
                    .strict(),
            })
            .strict(),
        targets: cantonOneSigRequestContextRefreshSchema.shape.targets,
    })
    .strict();
export type CantonOneSigScopeContextRefresh = z.infer<typeof cantonOneSigScopeContextRefreshSchema>;

export const cantonOneSigDiscoveryContextRefreshSchema = z
    .object({
        resolver: z
            .object({
                type: z.literal('oneSigDiscoveryContext'),
                informee: z.string().min(1),
                oappId: oneSigRequestIdentitySchema,
                feeDsoParty: z.string().min(1).optional(),
            })
            .strict(),
        targets: cantonOneSigRequestContextRefreshSchema.shape.targets,
    })
    .strict();
export type CantonOneSigDiscoveryContextRefresh = z.infer<
    typeof cantonOneSigDiscoveryContextRefreshSchema
>;

export const cantonOneSigTransferInstructionContextRefreshSchema = z
    .object({
        resolver: z
            .object({
                type: z.literal('oneSigTransferInstructionContext'),
                admin: z.string().min(1),
                informee: z.string().min(1),
                transferInstructionCid: z.string().min(1),
                environment: z.string().optional(),
                registryUrls: z.record(z.string(), z.string()).optional(),
            })
            .strict(),
        targets: cantonOneSigRequestContextRefreshSchema.shape.targets.length(1),
    })
    .strict();

export type CantonOneSigTransferInstructionContextRefresh = z.infer<
    typeof cantonOneSigTransferInstructionContextRefreshSchema
>;

export const cantonOneSigTransferBatchRefreshSchema = z
    .object({
        resolver: z
            .object({
                type: z.literal('oneSigTransferBatch'),
                admin: z.string().min(1),
                informee: z.string().min(1),
                environment: z.string().optional(),
                registryUrls: z.record(z.string(), z.string()).optional(),
            })
            .strict(),
        targets: cantonOneSigRequestContextRefreshSchema.shape.targets,
    })
    .strict();
export type CantonOneSigTransferBatchRefresh = z.infer<
    typeof cantonOneSigTransferBatchRefreshSchema
>;

const cantonTimestampRefreshSchema = z.object({
    resolver: z.object({
        type: z.literal('timestamp'),
    }),
    targets: z.array(cantonNestedArgumentRefreshTargetSchema).min(1),
});

export const cantonRefreshSchema = z.union([
    cantonActiveContractRefreshSchema,
    cantonActiveContractValueRefreshSchema,
    cantonAmuletContextRefreshSchema,
    cantonTransferInstructionAcceptContextRefreshSchema,
    cantonTimestampRefreshSchema,
    cantonFinalizeCallbackRefreshSchema,
    cantonOneSigRequestContextRefreshSchema,
    cantonOneSigConfigContextRefreshSchema,
    cantonOneSigScopeContextRefreshSchema,
    cantonOneSigDiscoveryContextRefreshSchema,
    cantonOneSigTransferInstructionContextRefreshSchema,
    cantonOneSigTransferBatchRefreshSchema,
]);

const cantonSentinelArgumentSchema = z.strictObject({
    path: z.array(
        z.union([
            cantonRefreshPathSegmentSchema.options[0].strict(),
            cantonRefreshPathSegmentSchema.options[1].strict(),
            cantonRefreshPathSegmentSchema.options[2].strict(),
        ]),
    ),
});
const cantonSentinelTargetSchema = z.union([
    exerciseChoiceArgumentTargetSchema
        .extend({ arguments: z.array(cantonSentinelArgumentSchema).min(1) })
        .strict(),
    cantonCreateArgumentTargetSchema
        .extend({ arguments: z.array(cantonSentinelArgumentSchema).min(1) })
        .strict(),
]);

export const cantonRefreshPlanSchema = z.object({
    commands: z.array(cantonRefreshSchema).min(1),
    replaceSentinels: z
        .array(
            z.strictObject({
                kind: z.literal('senderParty'),
                targets: z.array(cantonSentinelTargetSchema).min(1),
            }),
        )
        .min(1)
        .optional(),
});

export type CantonRefreshPathSegment = z.infer<typeof cantonRefreshPathSegmentSchema>;
export type CantonRefreshPath = z.infer<typeof cantonRefreshPathSchema>;
export type ExerciseEntrypointTargetField = Pick<
    z.infer<typeof exerciseEntrypointTargetSchema>,
    'field'
>;
export type ExerciseChoiceArgumentTargetField = Pick<
    z.infer<typeof exerciseChoiceArgumentTargetSchema>,
    'choice' | 'arguments'
>;
export type CantonRefreshTarget = z.infer<typeof cantonRefreshTargetSchema>;
export type CantonArgumentRefreshTarget = z.infer<typeof cantonArgumentRefreshTargetSchema>;
export type CantonContractSelector = z.infer<typeof cantonContractSelectorSchema>;
export type CantonActiveContractSelection = z.infer<typeof cantonActiveContractSelectionSchema>;
export type CantonActiveContractRefresh = z.infer<typeof cantonActiveContractRefreshSchema>;
export type CantonAmuletContextRefresh = z.infer<typeof cantonAmuletContextRefreshSchema>;
export type CantonTimestampRefresh = z.infer<typeof cantonTimestampRefreshSchema>;
export type CantonRefresh = z.infer<typeof cantonRefreshSchema>;
export type CantonRefreshPlan = z.infer<typeof cantonRefreshPlanSchema>;

export type CantonActiveContractValue = z.infer<typeof cantonActiveContractValueSchema>;
export type CantonActiveContractValueRefresh = z.infer<
    typeof cantonActiveContractValueRefreshSchema
>;
