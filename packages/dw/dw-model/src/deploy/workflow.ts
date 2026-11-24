import { z } from 'zod';

import type { SuccessfulGatedTransaction } from '@layerzerolabs/gated-transaction';
import { chainNameSchema } from '@layerzerolabs/layerzero-definitions';
import { customSchema } from '@layerzerolabs/zod-utils';

// ---------------------------------------------------------------------------
// Deprecated types (to be removed)
// ---------------------------------------------------------------------------

export const extractVerificationArtifactBaseArgsSchema = z.object({
    gtx: customSchema<SuccessfulGatedTransaction>(),
});
export type ExtractVerificationArtifactBaseArgs = z.infer<
    typeof extractVerificationArtifactBaseArgsSchema
>;

// ---------------------------------------------------------------------------
// Deploy workflow state schemas
// ---------------------------------------------------------------------------

export const deployWorkflowChainStateSchema = z.object({
    srcChain: chainNameSchema.optional(),
    status: z.union([z.literal('RUNNING'), z.literal('COMPLETE')]).default('RUNNING'),
});

export const deployWorkflowOrchestratorStateSchema = z.object({
    status: z.union([z.literal('RUNNING'), z.literal('COMPLETE')]).default('RUNNING'),
});

// ---------------------------------------------------------------------------
// Deploy workflow types
// ---------------------------------------------------------------------------

export type DeployWorkflowChainState = z.infer<typeof deployWorkflowChainStateSchema>;
export type DeployWorkflowOrchestratorState = z.infer<typeof deployWorkflowOrchestratorStateSchema>;
