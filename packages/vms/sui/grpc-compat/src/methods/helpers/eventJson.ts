import { fromBase64 } from '@mysten/sui-v2/utils';

import { LZ_EVENT_BYTE_VECTOR_FIELDS } from '@layerzerolabs/common-suimove/events';

import { splitTypeArgs } from '../../utils';

/**
 * `address::module::Name` or `address::module::Name<T1, T2>` -> `module::Name`. The address is
 * dropped deliberately: the same LZ event (e.g. `oft::OFTSentEvent`) is emitted by many different
 * OFT package deployments, each with its own address, so matching on the full address would miss
 * every deployment except one.
 */
export const eventModuleStructPath = (eventType: string): string =>
    splitTypeArgs(eventType).base.split('::').slice(-2).join('::');

const decodeBase64OrUndefined = (value: string): number[] | undefined => {
    try {
        return Array.from(fromBase64(value));
    } catch {
        return undefined;
    }
};

/**
 * v2's `Event.json` (a decoded `google.protobuf.Value`, see `../../utils/protoValue`) renders Move
 * `vector<u8>` fields as base64 strings, while legacy v1 renders the same bytes as a plain number
 * array. This looks up the known byte-vector field paths for `eventType` in
 * `LZ_EVENT_BYTE_VECTOR_FIELDS` and, for each one found in `parsedJson`, base64-decodes the string
 * in place into a number array so both transports agree. An explicit field list is used rather
 * than a base64-looks-like-bytes heuristic because a real base64 string field would false-positive
 * on that. Fields not listed (or events with no entry at all) are left untouched.
 *
 * Because matching ignores the package address, any package can emit an event whose listed field
 * holds an arbitrary string; such a value is left as-is rather than failing the whole response.
 */
export const applyByteVectorFixups = (parsedJson: unknown, eventType: string): unknown => {
    const fieldPaths = LZ_EVENT_BYTE_VECTOR_FIELDS[eventModuleStructPath(eventType)];
    if (!fieldPaths || typeof parsedJson !== 'object' || parsedJson === null) {
        return parsedJson;
    }

    for (const path of fieldPaths) {
        const keys = path.split('.');
        const lastKey = keys.pop()!;
        let cursor: Record<string, unknown> | undefined = parsedJson as Record<string, unknown>;
        for (const key of keys) {
            cursor = cursor?.[key] as Record<string, unknown> | undefined;
        }
        const value = cursor?.[lastKey];
        if (cursor && typeof value === 'string') {
            const decoded = decodeBase64OrUndefined(value);
            if (decoded) {
                cursor[lastKey] = decoded;
            }
        }
    }

    return parsedJson;
};
