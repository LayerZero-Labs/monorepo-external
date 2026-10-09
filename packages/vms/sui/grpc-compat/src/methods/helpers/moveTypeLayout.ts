import { type TypeTag, TypeTagSerializer } from '@mysten/sui/bcs';
import type { MoveValue } from '@mysten/sui/client';
import type { parseStructTag } from '@mysten/sui/utils';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { GrpcTypes, type SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { fromBase64 } from '@mysten/sui-v2/utils';

import { assertDefined, assertNestingDepth, toShortStructTag } from '../../utils';

type DatatypeDescriptor = GrpcTypes.DatatypeDescriptor;
type FieldDescriptor = GrpcTypes.FieldDescriptor;
type OpenSignatureBody = GrpcTypes.OpenSignatureBody;
const { OpenSignatureBody_Type, DatatypeDescriptor_DatatypeKind } = GrpcTypes;

export type MovePackageGrpcClient = Pick<SuiGrpcClient, 'movePackageService'>;

// `@mysten/sui/utils` doesn't export its `StructTag` type directly, so it's derived here.
type StructTag = ReturnType<typeof parseStructTag>;

// A concrete, fully-resolved Move type: a primitive keyword string, a datatype reference with its
// own concrete (possibly-vector) type arguments, or a vector of another resolved arg.
type MoveTypeArg = string | MoveDatatypeArg | { vector: MoveTypeArg };

// Like `StructTag`, but a type argument may itself be `{ vector }` — a shape
// `@mysten/sui/utils` has no way to represent, since real `StructTag.typeParams` only ever holds
// strings or nested `StructTag`s. `toStructTag` below flattens `{ vector }` back into a
// `vector<...>` string wherever a real `StructTag` is required (`normalizeStructTag`).
type MoveDatatypeArg = {
    address: string;
    module: string;
    name: string;
    typeParams: readonly MoveTypeArg[];
};

export type DatatypeResolver = (
    packageId: string,
    module: string,
    name: string,
) => Promise<DatatypeDescriptor>;

// One resolver per top-level call, so objects sharing a type fetch its layout only once.
export const createDatatypeResolver = (
    grpcClient: MovePackageGrpcClient,
    signal?: AbortSignal,
): DatatypeResolver => {
    const cache = new Map<string, Promise<DatatypeDescriptor>>();

    return (packageId, module, name) => {
        const key = `${packageId}::${module}::${name}`;
        let pending = cache.get(key);

        if (!pending) {
            pending = grpcClient.movePackageService
                .getDatatype({ packageId, moduleName: module, name }, { abort: signal })
                .then(({ response }) => {
                    if (!response.datatype) {
                        throw new Error(`Sui gRPC compat: unknown Move datatype ${key}`);
                    }
                    return response.datatype;
                });
            cache.set(key, pending);
        }

        return pending;
    };
};

const parseTypeName = (
    method: string,
    typeName: string,
): { packageId: string; module: string; name: string } => {
    const [packageId, module, name] = typeName.split('::');
    if (!packageId || !module || !name) {
        throw new Error(`Sui gRPC compat ${method}: malformed Move type name "${typeName}"`);
    }
    return { packageId, module, name };
};

const PRIMITIVE_TYPE_NAMES: Partial<Record<GrpcTypes.OpenSignatureBody_Type, string>> = {
    [OpenSignatureBody_Type.ADDRESS]: 'address',
    [OpenSignatureBody_Type.BOOL]: 'bool',
    [OpenSignatureBody_Type.U8]: 'u8',
    [OpenSignatureBody_Type.U16]: 'u16',
    [OpenSignatureBody_Type.U32]: 'u32',
    [OpenSignatureBody_Type.U64]: 'u64',
    [OpenSignatureBody_Type.U128]: 'u128',
    [OpenSignatureBody_Type.U256]: 'u256',
};

// u8/u16/u32 fit in a JS number and render as one on both transports; u64/u128/u256 render as a
// string on both (avoiding precision loss) — confirmed against a live full node (an UpgradeCap's
// `policy: u8` came back as the JSON number `0`, its `version: u64` as the string `"1"`, on both
// legacy and this shim).
const PRIMITIVE_TYPEOF: Readonly<Record<string, 'string' | 'boolean' | 'number'>> = {
    address: 'string',
    bool: 'boolean',
    u8: 'number',
    u16: 'number',
    u32: 'number',
    u64: 'string',
    u128: 'string',
    u256: 'string',
};

// A resolved type's size as Sui counts it: one node per primitive, vector and datatype, with the
// type written out in full. Sui rejects converting a type with more than 512 nodes to a value
// layout (`max_type_to_layout_nodes`, protocol v60+), so no real object or event type exceeds it.
// `max_type_nodes` (256) doesn't apply here: the verifier checks it per signature, before type
// arguments are substituted.
const MAX_TYPE_NODES = 512;

// Node counts per resolved type, so counting a parent reads its children's counts instead of
// re-walking them. A node-supplied descriptor can make one type argument appear at many positions
// (e.g. `Pair<T, T>`), so the type written out can be exponentially larger than the objects
// holding it.
const typeNodeCounts = new WeakMap<Exclude<MoveTypeArg, string>, number>();

const countTypeNodes = (method: string, arg: MoveTypeArg): number => {
    if (typeof arg === 'string') {
        return 1;
    }
    const cached = typeNodeCounts.get(arg);
    if (cached !== undefined) {
        return cached;
    }
    const children = 'vector' in arg ? [arg.vector] : arg.typeParams;
    const count = children.reduce((sum, child) => sum + countTypeNodes(method, child), 1);
    if (count > MAX_TYPE_NODES) {
        throw new Error(
            `Sui gRPC compat ${method}: Move type has more than ${MAX_TYPE_NODES} type nodes`,
        );
    }
    typeNodeCounts.set(arg, count);
    return count;
};

// Checks a newly built type's size before anything renders it: `moveTypeArgToString` writes out
// the whole type, so an oversized one would cost time and memory exponential in its depth.
const withinTypeNodeLimit = <T extends MoveTypeArg>(method: string, arg: T): T => {
    countTypeNodes(method, arg);
    return arg;
};

const moveTypeArgToString = (arg: MoveTypeArg): string =>
    typeof arg === 'string'
        ? arg
        : 'vector' in arg
          ? `vector<${moveTypeArgToString(arg.vector)}>`
          : normalizeStructTag(toStructTag(arg));

// Converts a resolved datatype arg into the real `StructTag` shape `normalizeStructTag` expects,
// flattening any nested `{ vector }` type parameter into its string form.
const toStructTag = (arg: MoveDatatypeArg): StructTag => ({
    address: arg.address,
    module: arg.module,
    name: arg.name,
    typeParams: arg.typeParams.map((param) =>
        typeof param === 'string' || 'vector' in param
            ? moveTypeArgToString(param)
            : toStructTag(param),
    ),
});

// Converts a `TypeTag` (from `TypeTagSerializer`, which — unlike `parseStructTag` — parses a
// `vector<...>` type argument into its own structured shape instead of leaving it as an opaque
// string, or mis-splitting a nested `vector<0x...::m::S>` on its inner `::`) into this module's
// own `MoveTypeArg` shape. Used only for a top-level object's own type arguments; see
// `renderObjectContentFields`.
const typeTagToMoveTypeArg = (method: string, tag: TypeTag): MoveTypeArg => {
    if ('vector' in tag) {
        return withinTypeNodeLimit(method, { vector: typeTagToMoveTypeArg(method, tag.vector) });
    }
    if ('struct' in tag) {
        return withinTypeNodeLimit(method, {
            address: tag.struct.address,
            module: tag.struct.module,
            name: tag.struct.name,
            typeParams: tag.struct.typeParams.map((param) => typeTagToMoveTypeArg(method, param)),
        });
    }
    // Every remaining variant is a primitive keyword ('bool', 'u8', ..., 'address', 'signer'),
    // present as this object's one key — `TypeTag`'s primitive keys are the same strings
    // `PRIMITIVE_TYPE_NAMES`/`PRIMITIVE_TYPEOF` use elsewhere in this file.
    const [primitive] = Object.keys(tag);
    return assertDefined(primitive, method, 'TypeTag primitive keyword');
};

// Shared by `resolveTypeArg`'s and `renderMoveValue`'s default (primitive) branches.
const resolvePrimitiveTypeName = (
    method: string,
    type: GrpcTypes.OpenSignatureBody_Type | undefined,
): string => {
    // `TYPE_UNKNOWN` (0) is the proto's own sentinel for "not one of the above", and an absent
    // `type` reads the same way, since 0 is a real enum value.
    const kind = type ?? OpenSignatureBody_Type.TYPE_UNKNOWN;
    const primitive = PRIMITIVE_TYPE_NAMES[kind];
    if (!primitive) {
        throw new Error(`Sui gRPC compat ${method}: unsupported Move field type ${kind}`);
    }
    return primitive;
};

// Validates a wire value against a resolved Move primitive keyword rather than trusting it
// blindly. Every string `MoveTypeArg` is one of these keywords — `vector<...>` and datatype
// references have their own `MoveTypeArg` variants and never reach here as a string.
const checkMoveValue = (method: string, typeName: string, value: unknown): MoveValue => {
    const expected = PRIMITIVE_TYPEOF[typeName];
    if (expected && typeof value !== expected) {
        throw new Error(
            `Sui gRPC compat ${method}: expected a ${expected} for Move type "${typeName}", received ${typeof value}`,
        );
    }
    return value as MoveValue;
};

// Looks up a `TYPE_PARAMETER` position (`typeArgs[index]`) against the caller's instantiation.
const resolveTypeParameter = (
    method: string,
    body: OpenSignatureBody,
    typeArgs: readonly MoveTypeArg[],
): MoveTypeArg => {
    const index = assertDefined(body.typeParameter, method, 'typeParameter');
    const arg = typeArgs[index];
    if (arg === undefined) {
        throw new Error(`Sui gRPC compat ${method}: unresolved Move type parameter #${index}`);
    }
    return arg;
};

// Builds the datatype arg for a `DATATYPE` `OpenSignatureBody`, substituting its own type
// parameters against the caller's instantiation.
const buildStructTag = (
    method: string,
    body: OpenSignatureBody,
    typeArgs: readonly MoveTypeArg[],
): MoveDatatypeArg => {
    const { packageId, module, name } = parseTypeName(
        method,
        assertDefined(body.typeName, method, 'typeName'),
    );
    return withinTypeNodeLimit(method, {
        address: packageId,
        module,
        name,
        typeParams: body.typeParameterInstantiation.map((arg) =>
            resolveTypeArg(method, arg, typeArgs),
        ),
    });
};

// Resolves a field's declared type down to a concrete `MoveTypeArg`, substituting
// `TYPE_PARAMETER` positions against the caller's instantiation (`typeArgs`).
//
// Each branch below reads a field the proto documents as "Set when `type` is" that same case
// (`typeParameter` for `TYPE_PARAMETER`, `typeName`/`typeParameterInstantiation[0]` for
// `DATATYPE`/`VECTOR`); the proto guarantees these are set whenever `body.type` matches their
// case, so `assertDefined` here enforces that invariant rather than handling a real absence.
const resolveTypeArg = (
    method: string,
    body: OpenSignatureBody,
    typeArgs: readonly MoveTypeArg[],
): MoveTypeArg => {
    switch (body.type) {
        case OpenSignatureBody_Type.TYPE_PARAMETER:
            return resolveTypeParameter(method, body, typeArgs);
        case OpenSignatureBody_Type.VECTOR: {
            const element = assertDefined(
                body.typeParameterInstantiation[0],
                method,
                'typeParameterInstantiation[0]',
            );
            return withinTypeNodeLimit(method, {
                vector: resolveTypeArg(method, element, typeArgs),
            });
        }
        case OpenSignatureBody_Type.DATATYPE:
            return buildStructTag(method, body, typeArgs);
        default:
            return resolvePrimitiveTypeName(method, body.type);
    }
};

const isFrameworkTag = (
    tag: MoveDatatypeArg,
    address: string,
    module: string,
    name: string,
): boolean =>
    tag.name === name &&
    tag.module === module &&
    normalizeSuiAddress(tag.address) === normalizeSuiAddress(address);

// Legacy wraps `0x2::object::UID` as `{id: <address>}` but leaves `0x2::object::ID` as a bare
// address (e.g. `UpgradeCap.package`) — both are already bare strings in v2's flat json.
const isUidTag = (tag: MoveDatatypeArg): boolean => isFrameworkTag(tag, '0x2', 'object', 'UID');
const isIdTag = (tag: MoveDatatypeArg): boolean => isFrameworkTag(tag, '0x2', 'object', 'ID');

// Sui's own object renderer (`crates/sui-types/src/object/rpc_visitor`) flattens these Move
// stdlib/framework wrapper types down to their single inner value on the wire, same as legacy —
// verified live against mainnet: a `Coin<SUI>`'s `balance: Balance<SUI>` field renders as the
// bare u64 string `"3252120"` on both transports, and a coin registry `Currency<SUI>`'s
// `name`/`symbol` (`string::String`/`ascii::String`) and `icon_url` (`Url`) all render as bare
// strings on both.
const isStringTag = (tag: MoveDatatypeArg): boolean =>
    isFrameworkTag(tag, '0x1', 'string', 'String') || isFrameworkTag(tag, '0x1', 'ascii', 'String');
const isUrlTag = (tag: MoveDatatypeArg): boolean => isFrameworkTag(tag, '0x2', 'url', 'Url');
// gRPC's own object renderer flattens this one too, but legacy doesn't: `try_convert_type`
// (`crates/sui-json-rpc-types/src/sui_move.rs`) has no special case for `TypeName`, so it falls
// through to a normal struct there. `renderDatatypeValue` re-wraps it below to match.
const isTypeNameTag = (tag: MoveDatatypeArg): boolean =>
    isFrameworkTag(tag, '0x1', 'type_name', 'TypeName');
const isBalanceTag = (tag: MoveDatatypeArg): boolean =>
    isFrameworkTag(tag, '0x2', 'balance', 'Balance');
// A declared field's own `None` never reaches `renderDatatypeValue` — `renderMoveValue`'s
// null/undefined check returns `null` before dispatching on `body.type`. But `Option<T>` reached
// as a vector element (`vector<Option<T>>`) or a type-parameter substitution goes through
// `renderMoveTypeArgValue` instead, which has no such check, so `None` there (`null` in the raw
// json) does reach here — handled explicitly in the branch below rather than assumed away.
const isOptionTag = (tag: MoveDatatypeArg): boolean =>
    isFrameworkTag(tag, '0x1', 'option', 'Option');

// Every declared struct/enum-variant field genuinely has a name — Move has no anonymous fields —
// so a missing one means the datatype descriptor itself is malformed.
const asFieldMap = (method: string, value: unknown, context: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(
            `Sui gRPC compat ${method}: expected an object for ${context}, received ${Array.isArray(value) ? 'array' : typeof value}`,
        );
    }
    return value as Record<string, unknown>;
};

// Move forbids recursive datatypes, but the descriptors driving this renderer come from the node,
// which could serve a struct whose field is its own type. Every recursive path below passes
// through `renderDatatypeValue` or `renderVectorValue`, so checking depth there bounds how deep
// the walk goes. The work done at each level is bounded separately, by `MAX_TYPE_NODES`.
const renderFields = async (
    method: string,
    value: unknown,
    context: string,
    fields: readonly FieldDescriptor[],
    typeArgs: readonly MoveTypeArg[],
    resolveDatatype: DatatypeResolver,
    depth: number,
): Promise<Record<string, MoveValue>> => {
    const fieldMap = asFieldMap(method, value, context);
    const entries = await Promise.all(
        fields.map(async (field): Promise<[string, MoveValue]> => {
            const name = assertDefined(field.name, method, 'fields[].name');
            const type = assertDefined(field.type, method, `fields[].type (field "${name}")`);
            return [
                name,
                await renderMoveValue(
                    method,
                    fieldMap[name],
                    type,
                    typeArgs,
                    resolveDatatype,
                    depth + 1,
                ),
            ];
        }),
    );
    return Object.fromEntries(entries);
};

// Dispatches on a resolved `MoveTypeArg` — a bare primitive keyword string, a vector, or a
// concrete datatype reference — the same way `renderMoveValue` dispatches on a field's own
// `OpenSignatureBody`. Used wherever a type argument has already been resolved down to this shape:
// a `TYPE_PARAMETER` substitution, `Option`'s inner value, or a vector's own element.
const renderMoveTypeArgValue = async (
    method: string,
    value: unknown,
    arg: MoveTypeArg,
    resolveDatatype: DatatypeResolver,
    depth: number,
): Promise<MoveValue> => {
    if (typeof arg === 'string') {
        return checkMoveValue(method, arg, value);
    }
    if ('vector' in arg) {
        return renderVectorValue(method, value, arg.vector, resolveDatatype, depth);
    }
    return renderDatatypeValue(method, value, arg, resolveDatatype, depth);
};

// Shared by a declared `vector<T>` field (`renderMoveValue`'s VECTOR case) and a `vector<T>` type
// argument substituted in through a type parameter (`renderMoveTypeArgValue`'s `{ vector }` case)
// — the wire shape is the same either way.
const renderVectorValue = async (
    method: string,
    value: unknown,
    element: MoveTypeArg,
    resolveDatatype: DatatypeResolver,
    depth: number,
): Promise<MoveValue> => {
    assertNestingDepth(depth, method, 'Move value');
    // v2 renders `vector<u8>` as a base64 string (protobuf's JSON mapping for `bytes`), while
    // legacy renders the same bytes as a plain number array — the same wire behavior
    // `eventJson.ts`'s `applyByteVectorFixups` already corrects for LZ event fields.
    if (element === 'u8') {
        if (typeof value !== 'string') {
            throw new Error(
                `Sui gRPC compat ${method}: expected a base64 string for a Move vector<u8> value, received ${typeof value}`,
            );
        }
        return Array.from(fromBase64(value));
    }
    if (!Array.isArray(value)) {
        throw new Error(
            `Sui gRPC compat ${method}: expected an array for a Move vector value, received ${typeof value}`,
        );
    }
    return Promise.all(
        value.map((entry) =>
            renderMoveTypeArgValue(method, entry, element, resolveDatatype, depth + 1),
        ),
    );
};

const renderDatatypeValue = async (
    method: string,
    value: unknown,
    tag: MoveDatatypeArg,
    resolveDatatype: DatatypeResolver,
    depth: number,
): Promise<MoveValue> => {
    assertNestingDepth(depth, method, 'Move value');
    if (isUidTag(tag)) {
        if (typeof value !== 'string') {
            throw new Error(
                `Sui gRPC compat ${method}: expected a string UID value for ${moveTypeArgToString(tag)}, received ${typeof value}`,
            );
        }
        return { id: value };
    }

    if (isIdTag(tag)) {
        if (typeof value !== 'string') {
            throw new Error(
                `Sui gRPC compat ${method}: expected a string ID value for ${moveTypeArgToString(tag)}, received ${typeof value}`,
            );
        }
        return value;
    }

    if (isStringTag(tag) || isUrlTag(tag)) {
        if (typeof value !== 'string') {
            throw new Error(
                `Sui gRPC compat ${method}: expected a string value for ${moveTypeArgToString(tag)}, received ${typeof value}`,
            );
        }
        return value;
    }

    // Unlike String/ascii::String/Url, legacy doesn't flatten this one — it falls through
    // `try_convert_type` to a normal struct — so it's re-wrapped to match instead of returned bare.
    if (isTypeNameTag(tag)) {
        if (typeof value !== 'string') {
            throw new Error(
                `Sui gRPC compat ${method}: expected a string value for ${moveTypeArgToString(tag)}, received ${typeof value}`,
            );
        }
        return { type: '0x1::type_name::TypeName', fields: { name: value } };
    }

    if (isBalanceTag(tag)) {
        return checkMoveValue(method, 'u64', value);
    }

    if (isOptionTag(tag)) {
        if (value === null || value === undefined) {
            return null;
        }
        const inner = assertDefined(tag.typeParams[0], method, 'typeParams[0] (Option)');
        return renderMoveTypeArgValue(method, value, inner, resolveDatatype, depth + 1);
    }

    const datatype = await resolveDatatype(tag.address, tag.module, tag.name);
    const type = toShortStructTag(moveTypeArgToString(tag));

    if (datatype.kind === DatatypeDescriptor_DatatypeKind.ENUM) {
        // v2's flat json already self-describes the active enum variant this way.
        const raw = asFieldMap(method, value, `enum value for ${type}`);
        const variantName = raw['@variant'];
        if (typeof variantName !== 'string') {
            throw new Error(
                `Sui gRPC compat ${method}: expected a string "@variant" for ${type}, received ${typeof variantName}`,
            );
        }
        const variant = datatype.variants.find((entry) => entry.name === variantName);
        if (!variant) {
            throw new Error(
                `Sui gRPC compat ${method}: unknown Move enum variant "${variantName}" for ${type}`,
            );
        }
        const fields = await renderFields(
            method,
            raw,
            `variant "${variantName}" of ${type}`,
            variant.fields,
            tag.typeParams,
            resolveDatatype,
            depth,
        );
        return { type, variant: variantName, fields };
    }

    const fields = await renderFields(
        method,
        value,
        `Move struct value for ${type}`,
        datatype.fields,
        tag.typeParams,
        resolveDatatype,
        depth,
    );
    return { type, fields };
};

const renderMoveValue = async (
    method: string,
    value: unknown,
    body: OpenSignatureBody,
    typeArgs: readonly MoveTypeArg[],
    resolveDatatype: DatatypeResolver,
    depth: number,
): Promise<MoveValue> => {
    if (value === null || value === undefined) {
        return null;
    }

    switch (body.type) {
        case OpenSignatureBody_Type.TYPE_PARAMETER: {
            const arg = resolveTypeParameter(method, body, typeArgs);
            return renderMoveTypeArgValue(method, value, arg, resolveDatatype, depth);
        }
        case OpenSignatureBody_Type.VECTOR: {
            const element = assertDefined(
                body.typeParameterInstantiation[0],
                method,
                'typeParameterInstantiation[0]',
            );
            // Resolved rather than rendered directly against `element`, so a `vector<T>` whose T
            // is itself a type parameter (e.g. a declared `vector<T>` field instantiated with
            // `T = u8`) still gets the `vector<u8>` byte-array treatment below.
            return renderVectorValue(
                method,
                value,
                resolveTypeArg(method, element, typeArgs),
                resolveDatatype,
                depth,
            );
        }
        case OpenSignatureBody_Type.DATATYPE:
            return renderDatatypeValue(
                method,
                value,
                buildStructTag(method, body, typeArgs),
                resolveDatatype,
                depth,
            );
        // Primitives already render identically on both transports.
        default:
            return checkMoveValue(method, resolvePrimitiveTypeName(method, body.type), value);
    }
};

// Top-level entry point: `objectType` is a plain type string, not a field's `OpenSignatureBody`,
// so it's parsed rather than resolved.
//
// `method` identifies the calling JSON-RPC method (`getObject`/`multiGetObjects`/
// `getOwnedObjects`) purely for error attribution.
export const renderObjectContentFields = async (
    method: string,
    objectType: string,
    json: unknown,
    resolveDatatype: DatatypeResolver,
): Promise<Record<string, MoveValue>> => {
    // `parseStructTag`'s own type-argument parser (`parseTypeTag`) either leaves a `vector<u8>`
    // type argument as an opaque string (never decomposed into anything this file can dispatch
    // on) or mis-splits a nested `vector<0x...::m::S>` on its inner `::` (address/module/name of
    // the top-level `objectType` itself always parse correctly regardless — only a *type
    // parameter* shaped like either of those is affected). `TypeTagSerializer` doesn't share
    // either gap — it recognizes `vector<...>` before ever trying to split on `::` — so it's used
    // here instead, purely for resolving the top-level object's own type arguments.
    const parsed = TypeTagSerializer.parseFromStr(objectType, true);
    if (!('struct' in parsed)) {
        throw new Error(
            `Sui gRPC compat ${method}: object type "${objectType}" is not a Move struct`,
        );
    }
    const { address, module, name, typeParams } = parsed.struct;
    const datatype = await resolveDatatype(address, module, name);

    if (datatype.kind === DatatypeDescriptor_DatatypeKind.ENUM) {
        throw new Error(
            `Sui gRPC compat ${method}: object type "${objectType}" is an enum, not a struct`,
        );
    }

    return renderFields(
        method,
        json,
        `Move struct value for ${objectType}`,
        datatype.fields,
        typeParams.map((typeParam) => typeTagToMoveTypeArg(method, typeParam)),
        resolveDatatype,
        0,
    );
};
