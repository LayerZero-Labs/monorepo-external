import z from 'zod';

import { chainNameSchema } from '@layerzerolabs/layerzero-definitions';
import { functionSchema } from '@layerzerolabs/zod-utils';

import type { ArtifactWithType } from './artifact';
import { ArtifactType, artifactWithTypeSchema } from './artifact';
import {
    resourceIdSchema,
    type ResourceRef,
    resourceRefSchema,
    resourceSubKeySchema,
} from './resourceRef';
import { resourceSetSchema } from './resourceSet';

export const realIdSchema = z.object({
    realIdKey: z.string(),
    // Omit when the RealID is not chain-scoped.
    chainName: chainNameSchema.optional(),
});

export type RealId = z.infer<typeof realIdSchema>;

export const artifactRegistryActivityFactorySchema = z.object({
    hasArtifact: functionSchema({
        input: z.tuple([
            z.object({
                ref: resourceRefSchema,
                artifactType: z.enum(ArtifactType),
            }),
        ]),
        output: z.promise(z.boolean()),
    }),

    getArtifact: functionSchema({
        input: z.tuple([
            z.object({
                ref: resourceRefSchema,
                artifactType: z.enum(ArtifactType),
            }),
        ]),
        output: z.promise(artifactWithTypeSchema.optional()),
    }) as z.ZodType<
        <Type extends ArtifactType>(args: {
            artifactType: Type;
            ref: ResourceRef;
        }) => Promise<Extract<ArtifactWithType, { artifactType: Type }> | undefined>
    >,

    saveArtifact: functionSchema({
        input: z.tuple([
            z.object({
                ref: resourceRefSchema,
                artifact: artifactWithTypeSchema,
            }),
        ]),
        output: z.promise(z.void()),
    }),
});

export interface ArtifactRegistry extends z.infer<typeof artifactRegistryActivityFactorySchema> {}

export interface MockArtifactRegistry extends ArtifactRegistry {
    getAllArtifacts: () => ArtifactWithType[];
}
export const createMockArtifactRegistry = (): MockArtifactRegistry => {
    const getArtifactKey = (args: Parameters<ArtifactRegistry['getArtifact']>[0]) =>
        JSON.stringify([args.artifactType, args.ref.resourceId, args.ref.resourceSubKey ?? null]);

    const artifactStore = new Map<string, ArtifactWithType>();

    const getArtifact: ArtifactRegistry['getArtifact'] = async (args) => {
        const value = artifactStore.get(getArtifactKey(args));
        if (value == null) {
            return undefined;
        }
        if (value.artifactType !== args.artifactType) {
            return undefined;
        }
        return value as Extract<ArtifactWithType, { artifactType: typeof args.artifactType }>;
    };

    const mockArtifactRegistry: MockArtifactRegistry = {
        getAllArtifacts: () => [...artifactStore.values()],

        hasArtifact: async (args) => artifactStore.has(getArtifactKey(args)),
        getArtifact,
        saveArtifact: async ({ ref, artifact }) => {
            artifactStore.set(
                getArtifactKey({ artifactType: artifact.artifactType, ref }),
                artifact,
            );
        },
    };

    return mockArtifactRegistry;
};

export const upsertResourceRealIdArgsSchema = z.object({
    ref: resourceRefSchema,
    realId: realIdSchema,
});

export const resourceRegistryActivityFactorySchema = z.object({
    getResourceRealId: functionSchema({
        input: z.tuple([z.object({ ref: resourceRefSchema })]),
        output: z.promise(realIdSchema.optional()),
    }),
    upsertResourceRealId: functionSchema({
        input: z.tuple([upsertResourceRealIdArgsSchema]),
        output: z.promise(z.void()),
    }),
    deleteResourceRealId: functionSchema({
        input: z.tuple([z.object({ ref: resourceRefSchema })]),
        output: z.promise(z.void()),
    }),

    // TODO: add pagination for large resource sets
    // Omit resourceId to list the full registry; pass resourceId for O(subkeys) scoped discovery.
    listResourceRealIds: functionSchema({
        input: z.tuple([
            z
                .object({
                    resourceId: resourceIdSchema.optional(),
                })
                .optional(),
        ]),
        output: z.promise(
            z.array(
                z.object({
                    resourceId: resourceIdSchema,
                    resourceSubKey: resourceSubKeySchema.optional(),
                    realId: realIdSchema,
                }),
            ),
        ),
    }),

    getResourceSet: functionSchema({
        input: z.tuple([resourceIdSchema]),
        output: z.promise(resourceSetSchema),
    }),
});

export interface ResourceRegistry extends z.infer<typeof resourceRegistryActivityFactorySchema> {}

/** RealID get/list surface required by {@link bindGetResourceSet}. */
export type ResourceRegistryRealIdAccess = Pick<
    ResourceRegistry,
    'getResourceRealId' | 'listResourceRealIds'
>;
