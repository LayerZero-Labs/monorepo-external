/**
 * v2 proto fields are typed as possibly `undefined` even when the gRPC server always sets them
 * for a given call — asserting presence surfaces a missing field as a loud error instead of
 * silently defaulting to `''`/`'0'` and returning a response that looks valid but isn't.
 */
export const assertDefined = <T>(value: T | null | undefined, method: string, field: string): T => {
    if (value === null || value === undefined) {
        throw new Error(`Sui gRPC compat ${method}: expected field to be present: ${field}`);
    }

    return value;
};

/**
 * Sui caps a Move value's nesting at 128 (`max_move_value_depth`). Rendered json can nest deeper
 * than the Move value itself (a struct adds a `fields` level), so this leaves headroom for any
 * real value while still stopping a node-supplied one nested deep enough to exhaust the stack.
 */
export const MAX_VALUE_NESTING_DEPTH = 256;

export const assertNestingDepth = (depth: number, method: string, what: string): void => {
    if (depth > MAX_VALUE_NESTING_DEPTH) {
        throw new Error(
            `Sui gRPC compat ${method}: ${what} nested deeper than ${MAX_VALUE_NESTING_DEPTH} levels`,
        );
    }
};
