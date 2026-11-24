/**
 * Whether a composite storage key (`resourceId` or `resourceId/subKey`) belongs to
 * the given resourceId. Uses `resourceId/` prefix — never bare startsWith
 * (so `foo` does not match `foobar`).
 */
export const isCompositeResourceIdInScope = ({
    compositeRef,
    resourceId,
}: {
    compositeRef: string;
    resourceId: string;
}): boolean => compositeRef === resourceId || compositeRef.startsWith(`${resourceId}/`);
