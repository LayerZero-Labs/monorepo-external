import type { SuiEvent } from '@mysten/sui/client';
import type { GrpcTypes } from '@mysten/sui-v2/grpc';
import { toBase64 } from '@mysten/sui-v2/utils';

import { assertDefined, protoValueToPlain, toShortStructTag } from '../../utils';
import { applyByteVectorFixups } from './eventJson';

/**
 * Field mapping shared by `getTransactionBlock` and `queryEvents`: both convert a gRPC `Event`
 * to `SuiEvent` the same way except for how `id` (txDigest/eventSeq) gets sourced, so callers
 * pass `method` (for `assertDefined`'s error messages) and build `id` themselves.
 */
export const buildSuiEventFields = (
    event: GrpcTypes.Event,
    method: string,
): Omit<SuiEvent, 'id'> => {
    const eventType = toShortStructTag(
        assertDefined(event.eventType, method, 'events[].eventType'),
    );

    return {
        packageId: assertDefined(event.packageId, method, 'events[].packageId'),
        transactionModule: assertDefined(event.module, method, 'events[].module'),
        sender: assertDefined(event.sender, method, 'events[].sender'),
        type: eventType,
        parsedJson: event.json
            ? applyByteVectorFixups(protoValueToPlain(event.json, method), eventType)
            : undefined,
        bcs: event.contents?.value ? toBase64(event.contents.value) : '',
        bcsEncoding: 'base64',
    };
};
