import type { SuiObjectData, SuiObjectDataOptions, SuiParsedData } from '@mysten/sui/client';
import type { GrpcTypes } from '@mysten/sui-v2/grpc';

import { assertDefined, mapGrpcOwner, protoValueToPlain, toShortStructTag } from '../../utils';
import type { DatatypeResolver } from './moveTypeLayout';
import { renderObjectContentFields } from './moveTypeLayout';

// Legacy always returns these unconditionally.
const BASE_READ_MASK_PATHS = ['object_id', 'version', 'digest'];

// showBcs/showDisplay aren't supported: throws so a future caller requesting either fails loudly,
// rather than getting back a response that looks valid but is silently missing the field.
export const buildObjectReadMaskPaths = (
    method: string,
    options: SuiObjectDataOptions | null | undefined,
): string[] => {
    if (options?.showBcs || options?.showDisplay) {
        throw new Error(
            `Sui gRPC compat ${method}: showBcs and showDisplay are not yet supported — no production caller requests them`,
        );
    }

    const paths = [...BASE_READ_MASK_PATHS];

    if (options?.showType) paths.push('object_type');
    if (options?.showOwner) paths.push('owner');
    if (options?.showContent) paths.push('object_type', 'json', 'has_public_transfer');
    if (options?.showPreviousTransaction) paths.push('previous_transaction');
    if (options?.showStorageRebate) paths.push('storage_rebate');

    return [...new Set(paths)];
};

// v2's `json` is flat; `renderObjectContentFields` reconstructs legacy's nested
// `{type, fields}`/`{id: <address>}`/`{type, variant, fields}` shape from the object's Move type
// layout. Packages have no struct fields, so they get an empty `disassembled` rather than real
// bytecode decoding.
//
// `method` identifies the calling JSON-RPC method (`getObject`/`multiGetObjects`/
// `getOwnedObjects`) purely for `assertDefined`'s error messages.
const toV1ObjectContent = async (
    method: string,
    raw: GrpcTypes.Object,
    resolveDatatype: DatatypeResolver,
): Promise<SuiParsedData> => {
    // `object_type` is always in the read mask whenever content is (`buildObjectReadMaskPaths`
    // pushes both together), so a real object always carries one here.
    const objectType = assertDefined(raw.objectType, method, 'objectType');

    if (objectType === 'package') {
        return { dataType: 'package', disassembled: {} };
    }

    const json = protoValueToPlain(raw.json, method);
    if (typeof json !== 'object' || json === null) {
        throw new Error(
            `Sui gRPC compat ${method}: expected a Move struct object for ${objectType}, received ${typeof json} for its json content`,
        );
    }

    const fields = await renderObjectContentFields(method, objectType, json, resolveDatatype);

    return {
        dataType: 'moveObject',
        type: toShortStructTag(objectType),
        // `has_public_transfer` is documented DEPRECATED in the proto ("no longer used ...
        // always calculated from the object's type when loaded in execution"), so a full node
        // may leave it unset even though it's in the read mask and the object is a Move struct —
        // `false` is the correct reading either way (the field's own default).
        hasPublicTransfer: raw.hasPublicTransfer ?? false,
        fields,
    };
};

// Only populates a field when its `show*` option was requested — legacy omits unrequested
// fields entirely (undefined), rather than returning them as falsy.
export const toV1ObjectData = async (
    method: string,
    raw: GrpcTypes.Object,
    options: SuiObjectDataOptions | null | undefined,
    resolveDatatype: DatatypeResolver,
): Promise<SuiObjectData> => ({
    // `object_id`/`version`/`digest` are unconditionally in the read mask
    // (`BASE_READ_MASK_PATHS`), so a resolved object always carries all three.
    objectId: assertDefined(raw.objectId, method, 'objectId'),
    version: assertDefined(raw.version, method, 'version').toString(),
    digest: assertDefined(raw.digest, method, 'digest'),
    type: options?.showType
        ? toShortStructTag(assertDefined(raw.objectType, method, 'objectType'))
        : undefined,
    owner: options?.showOwner ? mapGrpcOwner(raw.owner) : undefined,
    content: options?.showContent
        ? await toV1ObjectContent(method, raw, resolveDatatype)
        : undefined,
    // Every object has a creating/mutating transaction and a computed storage rebate (even a
    // freshly-created object's rebate is a real, if small, number) — never legitimately
    // absent once requested, unlike `hasPublicTransfer` above.
    previousTransaction: options?.showPreviousTransaction
        ? assertDefined(raw.previousTransaction, method, 'previousTransaction')
        : undefined,
    storageRebate: options?.showStorageRebate
        ? assertDefined(raw.storageRebate, method, 'storageRebate').toString()
        : undefined,
});
