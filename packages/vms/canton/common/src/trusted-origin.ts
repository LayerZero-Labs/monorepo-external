/**
 * Read a create-argument field, supporting dotted paths (`instrumentId.admin`).
 */
export const getCreateArgumentField = (createArgument: unknown, fieldPath: string): unknown => {
    let current: unknown = createArgument;
    for (const part of fieldPath.split('.')) {
        if (current == null || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
};

/**
 * True when every party in `expectedSignatories` is among the created-event signatories
 * (expected ⊆ ledger signatories). Opposite of `findMatchingCreatedEvent`, which
 * requires every ledger signatory to be in the expected/actAs set.
 *
 * Drops observer-only foreign contracts that would otherwise poison ACS cardinality.
 */
export const areExpectedSignatories = (
    created: { signatories?: readonly string[] },
    expectedSignatories: readonly string[],
): boolean => {
    if (expectedSignatories.length === 0) return false;
    const signatories = created.signatories ?? [];
    return expectedSignatories.every((party) => signatories.includes(party));
};

/**
 * True when `expectedParty` is among the created-event signatories.
 */
export const isSignatoryOrigin = (
    created: { signatories?: readonly string[] },
    expectedParty: string,
): boolean => areExpectedSignatories(created, [expectedParty]);

/**
 * True when a created event originated under `expectedParty`: that party is among
 * the created-event signatories, and `createArgument[createArgumentField]` equals it.
 *
 * Use when the template has multiple signatories and the party must bind a
 * specific payload role (e.g. Request `handler` amid sender / oappAdmin).
 * Prefer `contractStateFilter` + `expectedSignatories` on deferred refs instead.
 *
 * @param createArgumentField - Payload identity field (`owner`, `handler`,
 *   `admin`, or a dotted path such as `instrumentId.admin`).
 */
export const isTrustedOrigin = (
    created: { createArgument?: unknown; signatories?: readonly string[] },
    expectedParty: string,
    createArgumentField: string,
): boolean => {
    if (getCreateArgumentField(created.createArgument, createArgumentField) !== expectedParty) {
        return false;
    }
    return isSignatoryOrigin(created, expectedParty);
};
