import { z } from 'zod';

import { chainNameSchema } from '@layerzerolabs/layerzero-definitions';

import { filterChainsArgSchema, filterOperationsArgSchema } from '../filters';
import { PLANNER_CONCURRENCY } from './constants';

export const plannerBatchSizeSchema = z.int().min(1).max(PLANNER_CONCURRENCY);

export const plannerBatchSizeArgSchema = plannerBatchSizeSchema.default(PLANNER_CONCURRENCY);

export const wireWorkflowFilterArgsSchema = {
    filterChains: filterChainsArgSchema,
    filterOperations: filterOperationsArgSchema,
};

export const wireWorkflowChainResultSchema = z.object({
    results: z.array(
        z.union([
            z.object({
                name: z.string(),
                success: z.literal(false),
                error: z.string(),
            }),
            z.object({
                name: z.string(),
                success: z.literal(true),
                txHash: z.string(),
            }),
        ]),
    ),
});

export const wireWorkflowChainStateSchema = wireWorkflowChainResultSchema.extend({
    srcChain: chainNameSchema.optional(),
    status: z.union([z.literal('RUNNING'), z.literal('COMPLETE')]).default('RUNNING'),
});

export type WireWorkflowChainState = z.infer<typeof wireWorkflowChainStateSchema>;
export type WireWorkflowChainResult = z.infer<typeof wireWorkflowChainResultSchema>;

export const wireWorkflowOrchestratorResultSchema = z.object({
    stateByChain: z.partialRecord(chainNameSchema, wireWorkflowChainResultSchema).default({}),
});

export const wireWorkflowOrchestratorStateSchema = wireWorkflowOrchestratorResultSchema.extend({
    status: z.union([z.literal('RUNNING'), z.literal('COMPLETE')]).default('RUNNING'),
});

export type WireWorkflowOrchestratorState = z.infer<typeof wireWorkflowOrchestratorStateSchema>;
export type WireWorkflowOrchestratorResult = z.infer<typeof wireWorkflowOrchestratorResultSchema>;
