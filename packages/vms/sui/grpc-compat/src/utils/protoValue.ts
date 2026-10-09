import type { GrpcTypes } from '@mysten/sui-v2/grpc';

import { assertNestingDepth } from './assert';

// `Value` isn't exported directly, but `GrpcTypes.Object['json']` is typed as `Value | undefined`.
export type ProtoValue = NonNullable<GrpcTypes.Object['json']>;

const toPlain = (value: ProtoValue | undefined, method: string, depth: number): unknown => {
    if (!value || value.kind.oneofKind === undefined) {
        return null;
    }
    assertNestingDepth(depth, method, 'json value');

    switch (value.kind.oneofKind) {
        case 'nullValue':
            return null;
        case 'numberValue':
            return value.kind.numberValue;
        case 'stringValue':
            return value.kind.stringValue;
        case 'boolValue':
            return value.kind.boolValue;
        case 'structValue':
            return Object.fromEntries(
                Object.entries(value.kind.structValue.fields).map(([key, field]) => [
                    key,
                    toPlain(field, method, depth + 1),
                ]),
            );
        case 'listValue':
            return value.kind.listValue.values.map((entry) => toPlain(entry, method, depth + 1));
    }
};

// Reimplements `Value.toJson` (not exported) for this small, stable well-known-type mapping.
// `method` identifies the calling JSON-RPC method, for error attribution.
export const protoValueToPlain = (value: ProtoValue | undefined, method: string): unknown =>
    toPlain(value, method, 0);
