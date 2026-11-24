import z from 'zod';

import { normalizedHexSchema, type NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { throwError } from '@layerzerolabs/common-error-utils';
import { chainNameSchema } from '@layerzerolabs/layerzero-definitions';
import type { IsAny } from '@layerzerolabs/typescript-utils';

import { upgradeableConfigSchema } from '../upgrade';

export const baseResourceSchema = z.object({
    id: z.string(), // account-unique ID for this resource
    resourceBaseType: z.string() as z.ZodString | z.ZodLiteral,
});

export const baseMeshResourceSchema = z.object({
    ...baseResourceSchema.shape,
    resourceBaseType: z.literal('MESH'),
});

export const baseContractResourceSchema = z.object({
    ...baseResourceSchema.shape,
    resourceBaseType: z.literal('CONTRACT'),
    chainName: chainNameSchema,
    upgradeConfig: upgradeableConfigSchema.optional(),
    verifyContract: z.boolean().optional(),

    chainConfig: z.any().optional(),
});

export const withIntrinsicAddress = <T extends typeof baseContractResourceSchema>(
    resourceSchema: T,
) =>
    z.object({
        ...resourceSchema.shape,
        _INTRINSIC_normalizedAddress: normalizedHexSchema,
    }) as unknown as T['shape'] extends infer Shape extends Readonly<Record<string, z.ZodType>>
        ? z.ZodObject<
              {
                  [K in
                      | keyof Shape
                      | '_INTRINSIC_normalizedAddress']: K extends '_INTRINSIC_normalizedAddress'
                      ? typeof normalizedHexSchema
                      : K extends keyof Shape
                        ? Shape[K]
                        : never;
              },
              z.core.$strip
          >
        : never;

export type BaseResource = z.infer<typeof baseResourceSchema>;
export type BaseMeshResource = z.infer<typeof baseMeshResourceSchema>;
export type BaseContractResource = z.infer<typeof baseContractResourceSchema>;
export type BaseIntrinsicAddressContractResource = z.infer<ReturnType<typeof withIntrinsicAddress>>;

export const CONTRACT_RESOURCE_REFERENCE_PREFIX = '#C_REF:';

// The actual expected runtime value for this type is #C_REF:${id}
export type ContractResourceReference<T extends BaseContractResource = BaseContractResource> = {
    /** WARNING: these fields are not present at runtime */
    __resourceReferenceType: T;
    ['__CONTRACT_RESOURCE_REFERENCE']: true;
};

const findContractResourceReferenceId = (value: unknown): string | undefined =>
    typeof value === 'string' &&
    value.startsWith(CONTRACT_RESOURCE_REFERENCE_PREFIX) &&
    value.length > CONTRACT_RESOURCE_REFERENCE_PREFIX.length
        ? value.slice(CONTRACT_RESOURCE_REFERENCE_PREFIX.length)
        : undefined;

export const extractIdFromContractResourceReference = (ref: ContractResourceReference) =>
    findContractResourceReferenceId(ref) ??
    throwError(`Ref ${JSON.stringify(ref)} is not a contract resource ref`);

const describeInput = (input: unknown) =>
    input === undefined
        ? 'it is not set'
        : typeof input === 'string'
          ? `got ${JSON.stringify(input)}`
          : `got ${input === null ? 'null' : typeof input}`;

const contractResourceReferenceError = ({ input }: { input: unknown }) =>
    `must be a contract resource reference ${CONTRACT_RESOURCE_REFERENCE_PREFIX}<resource id>, made with .ref(); ${describeInput(input)}`;

const contractResourceReferenceStringSchema = z
    .string({ error: contractResourceReferenceError })
    .refine((value) => findContractResourceReferenceId(value) !== undefined, {
        error: contractResourceReferenceError,
    });

// Use z.ZodType<BaseContractResource> because we want to allow unions
export type ContractResourceReferenceSchema<T extends z.ZodType<BaseContractResource>> = z.ZodType<
    ContractResourceReference<z.infer<T>>
>;

export const contractResourceReferenceSchema: ContractResourceReferenceSchema<
    z.ZodType<BaseContractResource>
    // At runtime, we expect a string
> = contractResourceReferenceStringSchema.meta({
    id: 'contract-resource-dependency',
    title: 'Contract dependency to any',
    description: 'A reference to another contract resource (any)',
}) as unknown as z.ZodType<ContractResourceReference>;

let contractResourceDependencyForSchemaZodMetaIdIdx = 0;
export const contractResourceReferenceSchemaFor = <T extends z.ZodType<BaseContractResource>>(
    // TODO: use resource parameter to generate a concrete schema
    _resource: T,
): ContractResourceReferenceSchema<T> =>
    contractResourceReferenceStringSchema.meta({
        id: `contract-resource-dependency-for-${++contractResourceDependencyForSchemaZodMetaIdIdx}`,
        // We can't generate this properly yet because this function needs more information
        // Will be fixed when we clean up the runtime dependency ID resolution
        title: 'Contract dependency to (unknown)',
        description: 'A reference to another contract resource (unknown)',
    }) as unknown as z.ZodType<ContractResourceReference<z.infer<T>>>;

export type ResolvedContractResourceReference<T extends BaseContractResource> = {
    id: string;
    resource: T;
    address: NormalizedHexString;
};

export type ResolvedContractResourceReferenceSchema<T extends z.ZodType<BaseContractResource>> =
    z.ZodType<ResolvedContractResourceReference<z.infer<T>>>;

export const resolvedContractResourceReferenceSchema: ResolvedContractResourceReferenceSchema<any> =
    // TODO: replace with a concrete zod schema
    z.custom<ResolvedContractResourceReference<any>>();

// The actual expected runtime value for this type is #M_REF:${id}
export type MeshResourceReference<T extends BaseMeshResource = BaseMeshResource> = {
    /** WARNING: these fields are not present at runtime */
    __resourceReferenceType: T;
    ['__MESH_RESOURCE_REFERENCE']: true;
};

export type MeshResourceReferenceSchema<T extends typeof baseMeshResourceSchema> = z.ZodType<
    MeshResourceReference<z.infer<T>>
>;

export const meshResourceReferenceSchema: MeshResourceReferenceSchema<
    typeof baseMeshResourceSchema
> = z.string().meta({
    id: 'mesh-resource-dependency',
    title: 'Mesh dependency to any',
    description: 'A reference to another mesh resource (any)',
}) as unknown as z.ZodType<MeshResourceReference>;

let meshResourceDependencyForSchemaZodMetaIdIdx = 0;
export const meshResourceReferenceSchemaFor = <T extends typeof baseMeshResourceSchema>(
    // TODO: use resource parameter to generate a concrete schema
    _resource: T,
): MeshResourceReferenceSchema<T> =>
    z.string().meta({
        id: `mesh-resource-dependency-for-${++meshResourceDependencyForSchemaZodMetaIdIdx}`,
        title: 'Mesh dependency to (unknown)',
        description: 'A reference to another mesh resource (unknown)',
    }) as unknown as z.ZodType<MeshResourceReference<z.infer<T>>>;

export type ResolvedMeshResourceReference<T extends BaseMeshResource> = {
    id: string;
    resource: T;
    // TODO: is there any other resolved information we want to inject here?
};

export const extractIdFromMeshResourceReference = (ref: MeshResourceReference) =>
    ((ref as unknown as string).startsWith('#M_REF:') &&
        (ref as unknown as string).slice('#M_REF:'.length)) ||
    throwError(`Ref ${JSON.stringify(ref)} is not a mesh resource ref`);

export type ResolvedMeshResourceReferenceSchema<T extends typeof baseMeshResourceSchema> =
    // TODO: replace with a concrete zod schema
    z.ZodType<ResolvedMeshResourceReference<z.infer<T>>>;

export const resolvedMeshResourceReferenceSchema: ResolvedMeshResourceReferenceSchema<any> =
    z.custom<ResolvedMeshResourceReference<any>>();

export type ResolvedResourceSchema<Resource extends typeof baseResourceSchema> = z.ZodObject<
    {
        [K in Exclude<
            keyof Resource['shape'],
            '_INTRINSIC_normalizedAddress'
        >]: Resource['shape'][K] extends infer R extends z.ZodType
            ? R extends z.ZodAny
                ? R
                : R extends z.ZodOptional<z.ZodAny>
                  ? R
                  : R extends ContractResourceReferenceSchema<infer I>
                    ? ResolvedContractResourceReferenceSchema<I>
                    : R extends z.ZodOptional<ContractResourceReferenceSchema<infer I>>
                      ? z.ZodOptional<ResolvedContractResourceReferenceSchema<I>>
                      : R extends MeshResourceReferenceSchema<infer I>
                        ? ResolvedMeshResourceReferenceSchema<I>
                        : R extends z.ZodOptional<MeshResourceReferenceSchema<infer I>>
                          ? z.ZodOptional<ResolvedMeshResourceReferenceSchema<I>>
                          : R
            : never;
    },
    z.core.$strip
>;

export type ResolvedResource<Resource extends BaseResource> = {
    [K in Exclude<keyof Resource, '_INTRINSIC_normalizedAddress'>]: Resource[K] extends infer R
        ? R extends undefined
            ? R
            : IsAny<R> extends true
              ? R
              : IsAny<Exclude<R, undefined>> extends true
                ? R
                : R extends ContractResourceReference<infer I>
                  ? ResolvedContractResourceReference<I>
                  : R extends ContractResourceReference<infer I> | undefined
                    ? ResolvedContractResourceReference<I> | undefined
                    : R extends MeshResourceReference<infer I>
                      ? ResolvedMeshResourceReference<I>
                      : R extends MeshResourceReference<infer I> | undefined
                        ? ResolvedMeshResourceReference<I> | undefined
                        : R
        : never;
};

export const extractContractResourceReferences = <Resource extends BaseResource>(
    resource: Resource,
) =>
    Object.entries(resource).filter(
        ([, value]) => findContractResourceReferenceId(value) !== undefined,
    ) as unknown as [prop: string, id: ContractResourceReference][];

export const extractMeshResourceReferences = <Resource extends BaseResource>(resource: Resource) =>
    Object.entries(resource).filter(
        ([, id]) => typeof id === 'string' && id.startsWith('#M_REF:'),
    ) as unknown as [prop: string, id: MeshResourceReference][];

// TODO: implement runtime resolution — currently returns input schema as-is
export const createResolvedResourceSchema = <Resource extends typeof baseResourceSchema>(
    resource: Resource,
) => resource as ResolvedResourceSchema<Resource>;
