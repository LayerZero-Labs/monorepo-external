import z from 'zod';

import { chainNameSchema } from '@layerzerolabs/layerzero-definitions';
import { functionSchema } from '@layerzerolabs/zod-utils';

import {
    plannerBatchSizeSchema,
    wireWorkflowFilterArgsSchema,
    type WireWorkflowOrchestratorResult,
    wireWorkflowOrchestratorResultSchema,
} from './schemata';

const commonArgsSchema = z.object({
    callerWorkflowId: z.string(),
    callerRunId: z.string(),
    planId: z.string(),
    batchSize: plannerBatchSizeSchema,
    chainNames: z.array(chainNameSchema),
    // filters
    ...wireWorkflowFilterArgsSchema,
    pathwayScopeChains: z.array(chainNameSchema).optional(),
    allowSelfWiring: z.boolean().optional(),
    // ordered sender preference list
    senderEntityNames: z.array(z.string()).min(1),
    forceSend: z.boolean().optional(),
});

export type CommonArgs = z.infer<typeof commonArgsSchema>;

export interface WiringPlannerActivityFactoryImpl<T> {
    createPlan: (customArgs: T, commonArgs: CommonArgs) => Promise<void>;
    enactPlan: (customArgs: T, commonArgs: CommonArgs) => Promise<void>;
    assertPlan: (customArgs: T, commonArgs: CommonArgs) => Promise<WireWorkflowOrchestratorResult>;
}

export const createWiringPlannerActivityFactorySchema = <T extends z.ZodType>(
    customArgs: T,
): z.ZodType<WiringPlannerActivityFactoryImpl<z.infer<T>>> => {
    return z.object({
        createPlan: functionSchema({
            input: z.tuple([customArgs, commonArgsSchema]),
            output: z.promise(z.void()),
        }),
        enactPlan: functionSchema({
            input: z.tuple([customArgs, commonArgsSchema]),
            output: z.promise(z.void()),
        }),
        assertPlan: functionSchema({
            input: z.tuple([customArgs, commonArgsSchema]),
            output: z.promise(wireWorkflowOrchestratorResultSchema),
        }),
    });
};
