import type { z } from 'zod';

import type { normalizedHexSchema } from '@layerzerolabs/common-chain-model';
import { throwError } from '@layerzerolabs/common-error-utils';
import type { NormalizedHexString } from '@layerzerolabs/typescript-utils';

import {
    type BaseContractResource,
    type BaseMeshResource,
    type baseResourceSchema,
    CONTRACT_RESOURCE_REFERENCE_PREFIX,
    type ContractResourceReference,
    type MeshResourceReference,
} from './resources';

export type ContractResourceBuilderResult<Resource extends BaseContractResource> = {
    ref: () => ContractResourceReference<Resource>;
    build: () => Resource;
};

export type MeshResourceBuilderResult<Resource extends BaseMeshResource> = {
    ref: () => MeshResourceReference<Resource>;
    build: () => Resource;
};

export const createResourceBuilder =
    <
        T extends typeof baseResourceSchema,
        U extends Omit<z.infer<T>, 'type' | 'resourceBaseType' | '_INTRINSIC_normalizedAddress'>,
    >(
        _resourceSchema: T,
        {
            resourceBaseType,
            type,
        }: {
            resourceBaseType: 'CONTRACT' | 'MESH';
            type: T['shape'] extends { type: z.ZodType<infer Type> } ? Type : undefined;
        },
    ) =>
    (
        ...args: T extends z.ZodObject<{ _INTRINSIC_normalizedAddress: typeof normalizedHexSchema }>
            ? [
                  resource: U,
                  address: { nativeAddress: string } | { normalizedAddress: NormalizedHexString },
              ]
            : [resource: U]
    ): z.infer<T> extends BaseContractResource
        ? ContractResourceBuilderResult<z.infer<T>>
        : z.infer<T> extends BaseMeshResource
          ? MeshResourceBuilderResult<z.infer<T>>
          : never => {
        const resource = args[0];
        if (resourceBaseType === 'CONTRACT') {
            // cast because ts can't narrow T
            const addressArg = args[1 as number] as unknown as
                | { nativeAddress: string }
                | { normalizedAddress: NormalizedHexString };
            const _INTRINSIC_normalizedAddress: NormalizedHexString | undefined =
                addressArg && 'nativeAddress' in addressArg
                    ? throwError(
                          `Native address is currently not supported, use normalizedAddress instead`,
                      )
                    : addressArg?.normalizedAddress;

            return {
                ref: () => `${CONTRACT_RESOURCE_REFERENCE_PREFIX}${resource.id}` as any,
                build: () => ({
                    ...resource,
                    type,
                    resourceBaseType,
                    _INTRINSIC_normalizedAddress,
                }),
            } satisfies ContractResourceBuilderResult<any> as any;
        }

        if (resourceBaseType === 'MESH') {
            return {
                ref: () => `#M_REF:${resource.id}` as any,
                build: () => ({ ...resource, type, resourceBaseType }),
            } satisfies MeshResourceBuilderResult<any> as any;
        }

        throw new Error(`Can't handle resourceBaseType "${resourceBaseType}"`);
    };
