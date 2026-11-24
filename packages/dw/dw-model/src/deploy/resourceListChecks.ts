import type z from 'zod';

import type { ChainName } from '@layerzerolabs/layerzero-definitions';

import {
    type BaseContractResource,
    type BaseResource,
    extractContractResourceReferences,
    extractIdFromContractResourceReference,
} from './resources';

type TypedResource = BaseResource & { type: string; chainName?: ChainName };

const onChain = ({ chainName }: TypedResource) =>
    chainName === undefined ? '' : ` on ${chainName}`;

export type ContractResourceReferenceFields<Resource extends TypedResource> = {
    readonly [Type in Extract<Resource, BaseContractResource>['type']]?: {
        readonly [Field in keyof Extract<Resource, { type: Type }>]?: Resource['type'];
    };
};

export const checkContractResourceReferences =
    <Resource extends TypedResource>(fields: ContractResourceReferenceFields<Resource>) =>
    ({ resources }: { resources: readonly Resource[] }, ctx: z.RefinementCtx) => {
        const fieldsByType = new Map<string, Partial<Record<string, string>>>(
            Object.entries(fields),
        );
        const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
        resources.forEach((resource, index) => {
            const expectedTypes = new Map(Object.entries(fieldsByType.get(resource.type) ?? {}));
            for (const [field, reference] of extractContractResourceReferences(resource)) {
                const expectedType = expectedTypes.get(field);
                if (expectedType === undefined) {
                    continue;
                }
                const id = extractIdFromContractResourceReference(reference);
                const referenced = resourcesById.get(id);
                if (
                    referenced?.type === expectedType &&
                    referenced.chainName === resource.chainName
                ) {
                    continue;
                }
                const found = referenced
                    ? `${id} is a ${referenced.type}${onChain(referenced)}`
                    : `${id} is not a resource of this config`;
                ctx.addIssue({
                    code: 'custom',
                    path: ['resources', index, field],
                    message: `${resource.id}: ${field} must reference a ${expectedType} resource${onChain(resource)}; ${found}`,
                });
            }
        });
    };

export const checkUniqueResourceIds = (
    { resources }: { resources: readonly BaseResource[] },
    ctx: z.RefinementCtx,
) => {
    const firstIndexById = new Map<string, number>();
    resources.forEach(({ id }, index) => {
        const firstIndex = firstIndexById.get(id);
        if (firstIndex === undefined) {
            firstIndexById.set(id, index);
            return;
        }
        ctx.addIssue({
            code: 'custom',
            path: ['resources', index, 'id'],
            message: `${id} is already the ID of resources.${firstIndex}; resource IDs must be unique across all chains`,
        });
    });
};
