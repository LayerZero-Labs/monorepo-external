import { NonRetryableError } from '@layerzerolabs/common-error-utils';

import { assertResourceRef, type ResourceRef } from './resourceRef';

/**
 * Storage-key form of a resource ref: `resourceId` or `resourceId/resourceSubKey`.
 * Used by resource/artifact registries for map/DDB keys.
 */
export const createCompositeResourceRef = (ref: ResourceRef): string => {
    const { resourceId, resourceSubKey } = assertResourceRef(ref);

    if (resourceSubKey != null) {
        return `${resourceId}/${resourceSubKey}`;
    }

    return resourceId;
};

/**
 * Inverse of {@link createCompositeResourceRef}: parse a storage key into a structured ref.
 * List APIs must return this shape — never leave the composite string in `resourceId`.
 */
export const parseCompositeResourceRef = (compositeRef: string): ResourceRef => {
    if (compositeRef === '') {
        throw new NonRetryableError(`composite resource ref must not be empty`);
    }

    const slashIndex = compositeRef.indexOf('/');
    if (slashIndex === -1) {
        return assertResourceRef({ resourceId: compositeRef });
    }

    return assertResourceRef({
        resourceId: compositeRef.slice(0, slashIndex),
        resourceSubKey: compositeRef.slice(slashIndex + 1),
    });
};

/** Build a structured list row so callers never treat the storage composite as `resourceId`. */
export const listEntryFromCompositeRef = <TRealId>(
    compositeRef: string,
    realId: TRealId,
): ResourceRef & { realId: TRealId } => {
    const ref = parseCompositeResourceRef(compositeRef);
    return { ...ref, realId };
};
