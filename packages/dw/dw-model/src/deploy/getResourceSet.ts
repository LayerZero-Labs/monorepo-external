import { isNormalizedHex } from '@layerzerolabs/common-chain-model';
import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import type { NormalizedHexString } from '@layerzerolabs/typescript-utils';

import type { ResourceRegistryRealIdAccess } from './factoryInterfaces';
import type { ResourceSet } from './resourceSet';

export type GetResourceSet = (resourceId: string) => Promise<ResourceSet>;

/**
 * Invalid stored realIdKey must be NonRetryableError; ZodError is opaque and retryable.
 * This is data-shape validation (e.g. Base58 rows), not distrust of list scoping.
 */
const requireNormalizedRealIdKey = (realIdKey: string): NormalizedHexString => {
    if (!isNormalizedHex(realIdKey)) {
        throw new NonRetryableError(
            `Value is not normalized hex: "${realIdKey}"; getResourceSet requires NormalizedHex (0x...) realIdKey, not native`,
        );
    }
    return realIdKey as unknown as NormalizedHexString;
};

/**
 * Resolve the identity RealID and discover all known subkeys for a resourceId.
 *
 * Subkeys are discovered via scoped {@link ResourceRegistryRealIdAccess.listResourceRealIds}
 * (`{ resourceId }`). List rows must be structured (`resourceId` + optional `resourceSubKey`);
 * composite storage keys stay an implementation detail of get/put/delete.
 *
 * Prefer `ResourceRegistry.getResourceSet` from workflows.
 */
export const getResourceSet = async ({
    resourceId,
    resourceRegistry,
}: {
    resourceId: string;
    resourceRegistry: ResourceRegistryRealIdAccess;
}): Promise<ResourceSet> => {
    if (resourceId === '') {
        throw new NonRetryableError(`getResourceSet expects a non-empty resourceId`);
    }

    if (resourceId.includes('/')) {
        throw new NonRetryableError(
            `getResourceSet expects an unqualified resourceId; got subkey-qualified ref "${resourceId}"`,
        );
    }

    const identity = await resourceRegistry.getResourceRealId({ ref: { resourceId } });
    if (!identity) {
        throw new NonRetryableError(`No realId for resourceId "${resourceId}"`);
    }

    const entries = await resourceRegistry.listResourceRealIds({ resourceId });
    const subkeys: Record<string, NormalizedHexString> = {};

    for (const entry of entries) {
        if (!entry.resourceSubKey) {
            continue;
        }
        subkeys[entry.resourceSubKey] = requireNormalizedRealIdKey(entry.realId.realIdKey);
    }

    return {
        address: requireNormalizedRealIdKey(identity.realIdKey),
        subkeys,
    };
};

/** Wire registry get/list accessors into the shared getResourceSet implementation. */
export const bindGetResourceSet = (registry: ResourceRegistryRealIdAccess): GetResourceSet => {
    return (resourceId) => getResourceSet({ resourceId, resourceRegistry: registry });
};
