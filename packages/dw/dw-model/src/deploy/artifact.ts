import { z } from 'zod';

import { normalizedHexSchema } from '@layerzerolabs/common-chain-model';
import type { ChainName } from '@layerzerolabs/layerzero-definitions';
import { chainNameSchema } from '@layerzerolabs/layerzero-definitions';
import { brandSchema } from '@layerzerolabs/zod-utils';
export type { ChainName };

// TODO: merge deployment and verification artifacts
export enum ArtifactType {
    // Full record from deployment on-chain
    DEPLOYMENT = 'deployment',
    // Information to verify contracts
    VERIFICATION = 'verification',
    // Record of a successful push to LayerZero metadata
    METADATA = 'metadata',
}

export const artifactTypeSchema = brandSchema(z.enum(ArtifactType), 'ArtifactTypeSchema');

/**
 * Where a DEPLOYMENT artifact came from when not from a deployment run of the registry's app.
 * `seed`: imported from legacy address sources (any recorded deployer is a legacy one, not
 * this app's). Absent: written by a deployment (or by a seed run predating this field).
 */
export const deploymentArtifactSourceSchema = z.literal('seed');
export type DeploymentArtifactSource = z.infer<typeof deploymentArtifactSourceSchema>;

export const identityOnlyDeploymentArtifactSchema = z.object({
    chainName: chainNameSchema,
    address: normalizedHexSchema,
    source: deploymentArtifactSourceSchema.optional(),
});
export type IdentityOnlyDeploymentArtifact = z.infer<typeof identityOnlyDeploymentArtifactSchema>;

// TODO: include verification artifact in this schema
export const fullDeploymentArtifactSchema = z.object({
    ...identityOnlyDeploymentArtifactSchema.shape,
    chainName: chainNameSchema,
    address: normalizedHexSchema,
    nativeAddress: z.string(),
    bytecodeHash: z.string().optional(),
    deploymentTimestamp: z.number(),
    deployerAddress: normalizedHexSchema,
    txHash: z.string(),
    extraDeploymentInfo: z.any().optional(),
});
export type FullDeploymentArtifact = z.infer<typeof fullDeploymentArtifactSchema>;

// TODO: decide whether to migrate stored identity-only artifacts to full artifacts and collapse this union into fullDeploymentArtifactSchema
export const deploymentArtifactSchema = z.union([
    // Full schema first: it is a superset, so identity-only must not win the match.
    fullDeploymentArtifactSchema,
    identityOnlyDeploymentArtifactSchema,
]);

export type DeploymentArtifact = z.infer<typeof deploymentArtifactSchema>;

export const verificationArtifactSchema = z.any();

export type VerificationArtifact = z.infer<typeof verificationArtifactSchema>;

export const metadataArtifactSchema = z.object({
    jobId: z.string(),
    pushedAt: z.number(),
    // We can type this fully but probably needs to happen later
    metadataResources: z.array(z.any()),
});

export type MetadataArtifact = z.infer<typeof metadataArtifactSchema>;

export const artifactWithTypeSchema = z.discriminatedUnion('artifactType', [
    z.object({
        artifactType: z.literal(ArtifactType.DEPLOYMENT),
        artifact: deploymentArtifactSchema,
    }),
    z.object({
        artifactType: z.literal(ArtifactType.VERIFICATION),
        artifact: z.any().optional(),
    }),
    z.object({
        artifactType: z.literal(ArtifactType.METADATA),
        artifact: metadataArtifactSchema,
    }),
]);

export type ArtifactWithType = z.infer<typeof artifactWithTypeSchema>;
