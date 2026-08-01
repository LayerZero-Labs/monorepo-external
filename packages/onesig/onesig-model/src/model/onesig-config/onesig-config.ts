import { z } from 'zod';

/**
 * Executor configuration for a specific chain type.
 * All chains of the same type share the same executor configuration.
 */
export const oneSigExecutorConfigSchema = z.object({
    executors: z.array(z.string()), // Chain-specific addresses
    executorRequired: z.boolean(),
});

export type OneSigExecutorConfig = z.infer<typeof oneSigExecutorConfigSchema>;

export const oneSigOnchainConfigSchema = z.object({
    signers: z.array(z.string()),
    threshold: z.number(),
    seed: z.string(),
    executorConfigByChainType: z.record(z.string(), oneSigExecutorConfigSchema),
});

export type OneSigOnchainConfig = z.infer<typeof oneSigOnchainConfigSchema>;

export const oneSigOffchainConfigSchema = z.object({
    name: z.string(),
    contractAddresses: z.record(z.string(), z.string()),
    proposers: z.array(z.string()),
    witnesses: z.array(z.string()).optional(),
});

export type OneSigOffchainConfig = z.infer<typeof oneSigOffchainConfigSchema>;

/** Identifies who owns/manages this OneSig config. Absent means it was created via the standard flow. */
export enum OneSigConfigOwner {
    PRIVATE_API = 'private-api',
}

export const oneSigConfigOwnerSchema = z.enum(OneSigConfigOwner);

/**
 * Full OneSig configuration including both on-chain and off-chain values.
 * Extends onchain config with off-chain fields (proposers, witnesses) and metadata.
 */
export const oneSigConfigSchema = oneSigOnchainConfigSchema.extend({
    ...oneSigOffchainConfigSchema.shape,

    version: z.string().optional(),
    leafEncodingVersion: z.string().optional(),
    owner: oneSigConfigOwnerSchema
        .optional()
        .describe('Who owns/manages this config. Absent means standard flow.'),
    lastValidatedAt: z
        .number()
        .optional()
        .describe('When the config was last validated, unix timestamp in milliseconds'),
    createdAt: z
        .number()
        .optional()
        .describe('When the config was created, unix timestamp in milliseconds'),
    updatedAt: z
        .number()
        .optional()
        .describe('When the config was last updated, unix timestamp in milliseconds'),
    updatedBy: z.string().optional().describe('Who made the last update (workflow ID, user, etc.)'),
});

/**
 * @deprecated Use {@link OneSigInstanceConfig} instead. This flat config type is
 * retained for legacy backend consumers only and should not be used in new code.
 */
export type OneSigConfig = z.infer<typeof oneSigConfigSchema>;

// ============================================================================
// Instance & Member Types (V3 endpoints)
// ============================================================================

export enum OneSigRole {
    SIGNER = 'SIGNER',
    PROPOSER = 'PROPOSER',
    WITNESS = 'WITNESS',
}

export enum ManageMemberAction {
    ADD = 'ADD',
    REMOVE = 'REMOVE',
}

export enum ManageMemberRole {
    PROPOSER = 'PROPOSER',
    WITNESS = 'WITNESS',
}

export const oneSigRoleSchema = z.enum(OneSigRole);

export const oneSigSigningConfigSchema = z.object({
    seed: z.string(),
    threshold: z.number(),
    signers: z.array(z.string()),
});
export type OneSigSigningConfig = z.infer<typeof oneSigSigningConfigSchema>;

export const oneSigInstanceSummarySchema = z.object({
    name: z.string(),
    role: oneSigRoleSchema,
});
export type OneSigInstanceSummary = z.infer<typeof oneSigInstanceSummarySchema>;

export const oneSigPerChainConfigSchema = z.object({
    contractAddress: z.string(),
    signingConfig: z.string().describe('Hash referencing an entry in signingConfigs'),
    executionConfig: z
        .string()
        .optional()
        .describe('Hash referencing an entry in executionConfigs'),
    createdAt: z.number().optional().describe('When this chain config was created, unix ms'),
    updatedAt: z
        .number()
        .optional()
        .describe('When this chain config was last refreshed from chain, unix ms'),
});

export type OneSigPerChainConfig = z.infer<typeof oneSigPerChainConfigSchema>;

export const oneSigInstanceMembersSchema = z.object({
    proposers: z.array(z.string()),
    witnesses: z.array(z.string()),
});

export type OneSigInstanceMembers = z.infer<typeof oneSigInstanceMembersSchema>;

/**
 * Partition of chains that share the same signing config.
 * Present when the API includes partition metadata; otherwise derive from
 * signingConfigs + perChainConfigs. Unused by legacy flat-config consumers.
 */
export const oneSigPartitionSchema = z.object({
    signingConfigHash: z.string(),
    chains: z.array(z.string()),
});

export type OneSigPartition = z.infer<typeof oneSigPartitionSchema>;

export const oneSigInstanceConfigSchema = z.object({
    name: z.string(),
    members: oneSigInstanceMembersSchema,
    signingConfigs: z
        .record(z.string(), oneSigSigningConfigSchema)
        .describe('Signing configs keyed by content hash'),
    executionConfigs: z
        .record(z.string(), oneSigExecutorConfigSchema)
        .describe('Execution configs keyed by content hash'),
    perChainConfigs: z.record(z.string(), oneSigPerChainConfigSchema),
    version: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
});

export type OneSigInstanceConfig = z.infer<typeof oneSigInstanceConfigSchema>;

export const listOneSigInstancesResponseSchema = z.object({
    instances: z.array(oneSigInstanceSummarySchema),
    nextToken: z.string().nullable(),
});

export type ListOneSigInstancesResponse = z.infer<typeof listOneSigInstancesResponseSchema>;

export const manageMemberActionSchema = z.enum(ManageMemberAction);
export const manageMemberRoleSchema = z.enum(ManageMemberRole);

export const manageMemberRequestSchema = z.object({
    action: manageMemberActionSchema,
    role: manageMemberRoleSchema,
    addresses: z.array(z.string()),
});

export type ManageMemberRequest = z.infer<typeof manageMemberRequestSchema>;

export enum DeployOneSigOrchestratorStatus {
    INIT = 'INIT',
    ONE_SIG_CONFIG_NOT_FOUND = 'ONE_SIG_CONFIG_NOT_FOUND',
    DEPLOYING = 'DEPLOYING',
    STORING_CONFIG = 'STORING_CONFIG',
    STORE_CONFIG_FAILED = 'STORE_CONFIG_FAILED',
    /** Some chain deployments failed, but partial config was stored to DB */
    PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
    SUCCEEDED = 'SUCCEEDED',
}
