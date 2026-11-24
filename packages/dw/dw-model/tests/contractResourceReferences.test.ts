import { describe, expect, it } from 'vitest';
import z from 'zod';

import { ChainName } from '@layerzerolabs/layerzero-definitions';

import {
    baseContractResourceSchema,
    baseMeshResourceSchema,
    checkContractResourceReferences,
    checkUniqueResourceIds,
    CONTRACT_RESOURCE_REFERENCE_PREFIX,
    contractResourceReferenceSchema,
    contractResourceReferenceSchemaFor,
    createResourceBuilder,
    extractContractResourceReferences,
    extractIdFromContractResourceReference,
} from '../src';

const tokenSchema = z.object({
    ...baseContractResourceSchema.shape,
    type: z.literal('TOKEN'),
});
const createToken = createResourceBuilder(tokenSchema, {
    resourceBaseType: 'CONTRACT',
    type: 'TOKEN',
});

const guardSchema = z.object({
    ...baseContractResourceSchema.shape,
    type: z.literal('GUARD'),
});
const createGuard = createResourceBuilder(guardSchema, {
    resourceBaseType: 'CONTRACT',
    type: 'GUARD',
});

const hubSchema = z.object({
    ...baseContractResourceSchema.shape,
    type: z.literal('HUB'),
    token: contractResourceReferenceSchemaFor(tokenSchema),
    guard: contractResourceReferenceSchemaFor(guardSchema).optional(),
});
const createHub = createResourceBuilder(hubSchema, { resourceBaseType: 'CONTRACT', type: 'HUB' });

const meshSchema = z.object({
    ...baseMeshResourceSchema.shape,
    type: z.literal('MESH'),
});
const createMesh = createResourceBuilder(meshSchema, { resourceBaseType: 'MESH', type: 'MESH' });

const resourceSchema = z.discriminatedUnion('type', [
    tokenSchema,
    guardSchema,
    hubSchema,
    meshSchema,
]);

type Resource = z.infer<typeof resourceSchema>;

const configSchema = z
    .object({ resources: z.array(resourceSchema) })
    .superRefine(checkUniqueResourceIds)
    .superRefine(
        checkContractResourceReferences<Resource>({ HUB: { token: 'TOKEN', guard: 'GUARD' } }),
    );

const issuesOf = (value: unknown) => {
    const result = configSchema.safeParse(value);
    return result.success
        ? []
        : result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message }));
};

const token = (chainName: ChainName = ChainName.ETHEREUM) =>
    createToken({ id: `token-${chainName}`, chainName });
const guard = (chainName: ChainName = ChainName.ETHEREUM) =>
    createGuard({ id: `guard-${chainName}`, chainName });
const hub = (refs: { token: string; guard?: string }) => ({
    ...createHub({
        id: 'hub-ethereum',
        chainName: ChainName.ETHEREUM,
        token: token().ref(),
    }).build(),
    ...refs,
});

describe('contract resource references', () => {
    it('makes a reference with .ref() from the prefix and the resource ID', () => {
        expect(token().ref()).toBe(`${CONTRACT_RESOURCE_REFERENCE_PREFIX}token-ethereum`);
    });

    it('extracts the fields that hold a reference with an ID, and not a prefix without an ID or a bare ID', () => {
        const resource = hub({ token: '#C_REF:token-ethereum', guard: '#C_REF:' });

        expect(extractContractResourceReferences(resource)).toEqual([
            ['token', '#C_REF:token-ethereum'],
        ]);
        expect(extractContractResourceReferences({ ...resource, token: 'token-ethereum' })).toEqual(
            [],
        );
    });

    it('extracts the resource ID of a reference made with .ref()', () => {
        expect(extractIdFromContractResourceReference(token().ref())).toBe('token-ethereum');
    });
});

describe('contract resource reference field schema', () => {
    const schema = z.object({ token: contractResourceReferenceSchemaFor(tokenSchema) });
    const fieldIssues = (value: unknown) => {
        const result = schema.safeParse({ token: value });
        return result.success
            ? []
            : result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message }));
    };

    it('parses a reference made with .ref()', () => {
        expect(schema.parse({ token: token().ref() })).toEqual({ token: '#C_REF:token-ethereum' });
    });

    it.each([
        ['a prefix without an ID', '#C_REF:', 'got "#C_REF:"'],
        ['a bare resource ID', 'token-ethereum', 'got "token-ethereum"'],
        ['a mesh reference', '#M_REF:token-ethereum', 'got "#M_REF:token-ethereum"'],
        ['a number', 5, 'got number'],
        ['an unset value', undefined, 'it is not set'],
    ])('rejects %s at the field, naming what it got', (_, value, got) => {
        expect(fieldIssues(value)).toEqual([
            {
                path: 'token',
                message: `must be a contract resource reference #C_REF:<resource id>, made with .ref(); ${got}`,
            },
        ]);
    });

    it('keeps the JSON schema of a reference field a string with its title and description', () => {
        const { $ref, $defs, ...root } = z.toJSONSchema(
            contractResourceReferenceSchemaFor(tokenSchema),
        );

        expect(root).toEqual({ $schema: 'https://json-schema.org/draft/2020-12/schema' });
        expect($ref).toMatch(/^#\/\$defs\/contract-resource-dependency-for-\d+$/);
        expect($defs).toEqual({
            [$ref?.replace('#/$defs/', '') ?? '']: {
                type: 'string',
                title: 'Contract dependency to (unknown)',
                description: 'A reference to another contract resource (unknown)',
            },
        });
    });
});

describe('contract resource reference field schema for any resource', () => {
    const schema = z.object({ resourceId: contractResourceReferenceSchema });
    const fieldIssues = (value: unknown) => {
        const result = schema.safeParse({ resourceId: value });
        return result.success
            ? []
            : result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message }));
    };

    it('parses a reference made with .ref()', () => {
        expect(schema.parse({ resourceId: token().ref() })).toEqual({
            resourceId: '#C_REF:token-ethereum',
        });
    });

    it.each([
        ['a prefix without an ID', '#C_REF:', 'got "#C_REF:"'],
        ['a bare resource ID', 'token-ethereum', 'got "token-ethereum"'],
    ])('rejects %s at the field, naming what it got', (_, value, got) => {
        expect(fieldIssues(value)).toEqual([
            {
                path: 'resourceId',
                message: `must be a contract resource reference #C_REF:<resource id>, made with .ref(); ${got}`,
            },
        ]);
    });

    it('keeps the JSON schema of the field a string with its ID, title, and description', () => {
        expect(z.toJSONSchema(contractResourceReferenceSchema)).toEqual({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $ref: '#/$defs/contract-resource-dependency',
            $defs: {
                'contract-resource-dependency': {
                    type: 'string',
                    title: 'Contract dependency to any',
                    description: 'A reference to another contract resource (any)',
                },
            },
        });
    });
});

describe('resource list checks', () => {
    it('finds no issue in a list whose references point to resources of the expected type on the same chain', () => {
        expect(
            issuesOf({
                resources: [
                    token().build(),
                    guard().build(),
                    hub({ token: '#C_REF:token-ethereum', guard: '#C_REF:guard-ethereum' }),
                    createMesh({ id: 'mesh' }).build(),
                ],
            }),
        ).toEqual([]);
    });

    it('rejects a reference to a resource that is not in the list, naming the resource, field, expected type, and chain', () => {
        expect(issuesOf({ resources: [hub({ token: '#C_REF:token-ethereum' })] })).toEqual([
            {
                path: 'resources.0.token',
                message:
                    'hub-ethereum: token must reference a TOKEN resource on ethereum; token-ethereum is not a resource of this config',
            },
        ]);
    });

    it('rejects a reference to a resource of another type, naming the resource, field, expected type, and chain', () => {
        expect(
            issuesOf({
                resources: [
                    token().build(),
                    guard().build(),
                    hub({ token: '#C_REF:guard-ethereum' }),
                ],
            }),
        ).toEqual([
            {
                path: 'resources.2.token',
                message:
                    'hub-ethereum: token must reference a TOKEN resource on ethereum; guard-ethereum is a GUARD on ethereum',
            },
        ]);
    });

    it('rejects a reference to a resource on another chain, naming the resource, field, expected type, and chain', () => {
        expect(
            issuesOf({
                resources: [
                    token(ChainName.ARBITRUM).build(),
                    hub({ token: '#C_REF:token-arbitrum' }),
                ],
            }),
        ).toEqual([
            {
                path: 'resources.1.token',
                message:
                    'hub-ethereum: token must reference a TOKEN resource on ethereum; token-arbitrum is a TOKEN on arbitrum',
            },
        ]);
    });

    it('checks every reference field that the map names for a resource type, at the field that fails', () => {
        expect(
            issuesOf({
                resources: [
                    token().build(),
                    hub({ token: '#C_REF:token-ethereum', guard: '#C_REF:guard-ethereum' }),
                ],
            }),
        ).toEqual([
            {
                path: 'resources.1.guard',
                message:
                    'hub-ethereum: guard must reference a GUARD resource on ethereum; guard-ethereum is not a resource of this config',
            },
        ]);
    });

    it('parses a list with a malformed reference without throwing, with one issue at that field', () => {
        expect(
            issuesOf({ resources: [token().build(), hub({ token: '#C_REF:' })] }).map(
                ({ path }) => path,
            ),
        ).toEqual(['resources.1.token']);
    });

    it.each([
        ['on the same chain', ChainName.ETHEREUM],
        ['on another chain', ChainName.ARBITRUM],
    ])('rejects a second resource with an ID already used %s, naming the ID', (_, chainName) => {
        expect(
            issuesOf({ resources: [token().build(), { ...token().build(), chainName }] }),
        ).toEqual([
            {
                path: 'resources.1.id',
                message:
                    'token-ethereum is already the ID of resources.0; resource IDs must be unique across all chains',
            },
        ]);
    });
});
