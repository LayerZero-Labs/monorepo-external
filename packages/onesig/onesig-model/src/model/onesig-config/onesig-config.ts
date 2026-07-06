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

export type OneSigInstanceSummary = {
    name: string;
    role: OneSigRole;
};

export type OneSigSigningConfig = {
    seed: string;
    threshold: number;
    signers: string[];
};

export type OneSigPerChainConfig = {
    contractAddress: string;
    signingConfig: string;
    executionConfig?: string;
};

export type OneSigInstanceMembers = {
    proposers: string[];
    witnesses: string[];
};

export type OneSigInstanceConfig = {
    name: string;
    members: OneSigInstanceMembers;
    signingConfigs: Record<string, OneSigSigningConfig>;
    executionConfigs: Record<string, OneSigExecutorConfig>;
    perChainConfigs: Record<string, OneSigPerChainConfig>;
    version?: string;
    createdAt?: number;
    updatedAt?: number;
};

export type ManageMemberRequest = {
    action: ManageMemberAction;
    role: ManageMemberRole;
    addresses: string[];
};

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
