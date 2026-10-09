import { normalizeSuiAddress } from '@mysten/sui/utils';
import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { toBase64 } from '@mysten/sui-v2/utils';
import { describe, expect, it, vi } from 'vitest';

import {
    createDatatypeResolver,
    type MovePackageGrpcClient,
    renderObjectContentFields,
} from './moveTypeLayout';

const { OpenSignatureBody_Type, DatatypeDescriptor_DatatypeKind } = GrpcTypes;

const METHOD = 'getObject';

const UID_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x2::object::UID',
    typeParameterInstantiation: [],
};
const ID_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x2::object::ID',
    typeParameterInstantiation: [],
};
const U64_TYPE = { type: OpenSignatureBody_Type.U64, typeParameterInstantiation: [] };
const STRING_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x1::string::String',
    typeParameterInstantiation: [],
};
const ASCII_STRING_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x1::ascii::String',
    typeParameterInstantiation: [],
};
const URL_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x2::url::Url',
    typeParameterInstantiation: [],
};
const TYPE_NAME_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x1::type_name::TypeName',
    typeParameterInstantiation: [],
};
const BALANCE_SUI_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x2::balance::Balance',
    typeParameterInstantiation: [
        {
            type: OpenSignatureBody_Type.DATATYPE,
            typeName: '0x2::sui::SUI',
            typeParameterInstantiation: [],
        },
    ],
};
const OPTION_U64_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x1::option::Option',
    typeParameterInstantiation: [U64_TYPE],
};
const OPTION_ITEM_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x1::option::Option',
    typeParameterInstantiation: [
        {
            type: OpenSignatureBody_Type.DATATYPE,
            typeName: '0xabc::example::Item',
            typeParameterInstantiation: [],
        },
    ],
};
const U8_TYPE = { type: OpenSignatureBody_Type.U8, typeParameterInstantiation: [] };
const BYTES_TYPE = {
    type: OpenSignatureBody_Type.VECTOR,
    typeParameterInstantiation: [U8_TYPE],
};
const VECTOR_ITEM_TYPE = {
    type: OpenSignatureBody_Type.VECTOR,
    typeParameterInstantiation: [
        {
            type: OpenSignatureBody_Type.DATATYPE,
            typeName: '0xabc::example::Item',
            typeParameterInstantiation: [],
        },
    ],
};
const BOX_OF_BYTES_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0xabc::example::Box',
    typeParameterInstantiation: [BYTES_TYPE],
};
const BOX_OF_ITEMS_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0xabc::example::Box',
    typeParameterInstantiation: [VECTOR_ITEM_TYPE],
};
const OPTION_BYTES_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0x1::option::Option',
    typeParameterInstantiation: [BYTES_TYPE],
};
const LIST_BOX_OF_U8_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0xabc::example::ListBox',
    typeParameterInstantiation: [U8_TYPE],
};
const VECTOR_OF_OPTION_U64_TYPE = {
    type: OpenSignatureBody_Type.VECTOR,
    typeParameterInstantiation: [OPTION_U64_TYPE],
};

// Top-level object types go through `TypeTagSerializer`, which normalizes the address to its full
// 32-byte form; nested `typeName` references don't, so only the top-level keys need this.
// Move forbids recursive datatypes, but these descriptors come from the node, so a malicious one
// can serve them. `Loop` declares a field of its own type; `GrowingLoop<T>`'s field is
// `GrowingLoop<Pair<T, T>>`, so its type doubles in size at every level.
const LOOP_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0xabc::example::Loop',
    typeParameterInstantiation: [],
};
const TYPE_PARAMETER_0 = {
    type: OpenSignatureBody_Type.TYPE_PARAMETER,
    typeParameter: 0,
    typeParameterInstantiation: [],
};
const GROWING_LOOP_OF_PAIR_TYPE = {
    type: OpenSignatureBody_Type.DATATYPE,
    typeName: '0xabc::example::GrowingLoop',
    typeParameterInstantiation: [
        {
            type: OpenSignatureBody_Type.DATATYPE,
            typeName: '0xabc::example::Pair',
            typeParameterInstantiation: [TYPE_PARAMETER_0, TYPE_PARAMETER_0],
        },
    ],
};
const LOOP_DATATYPE = {
    typeName: '0xabc::example::Loop',
    definingId: '0xabc',
    module: 'example',
    name: 'Loop',
    kind: DatatypeDescriptor_DatatypeKind.STRUCT,
    fields: [{ name: 'next', position: 0, type: LOOP_TYPE }],
    variants: [],
};
const GROWING_LOOP_DATATYPE = {
    typeName: '0xabc::example::GrowingLoop',
    definingId: '0xabc',
    module: 'example',
    name: 'GrowingLoop',
    kind: DatatypeDescriptor_DatatypeKind.STRUCT,
    fields: [{ name: 'next', position: 0, type: GROWING_LOOP_OF_PAIR_TYPE }],
    variants: [],
};

const NORMALIZED_ABC = normalizeSuiAddress('0xabc');

const DATATYPES = {
    [`${NORMALIZED_ABC}::example::Wrapper`]: {
        typeName: '0xabc::example::Wrapper',
        definingId: '0xabc',
        module: 'example',
        name: 'Wrapper',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            { name: 'id', position: 0, type: UID_TYPE },
            {
                name: 'box',
                position: 1,
                type: {
                    type: OpenSignatureBody_Type.DATATYPE,
                    typeName: '0xabc::example::Box',
                    typeParameterInstantiation: [
                        {
                            type: OpenSignatureBody_Type.DATATYPE,
                            typeName: '0xabc::example::Item',
                            typeParameterInstantiation: [],
                        },
                    ],
                },
            },
        ],
        variants: [],
    },
    '0xabc::example::Box': {
        typeName: '0xabc::example::Box',
        definingId: '0xabc',
        module: 'example',
        name: 'Box',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            {
                name: 'value',
                position: 0,
                type: {
                    type: OpenSignatureBody_Type.TYPE_PARAMETER,
                    typeParameter: 0,
                    typeParameterInstantiation: [],
                },
            },
        ],
        variants: [],
    },
    '0xabc::example::Item': {
        typeName: '0xabc::example::Item',
        definingId: '0xabc',
        module: 'example',
        name: 'Item',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [{ name: 'value', position: 0, type: U64_TYPE }],
        variants: [],
    },
    [`${NORMALIZED_ABC}::example::Ref`]: {
        typeName: '0xabc::example::Ref',
        definingId: '0xabc',
        module: 'example',
        name: 'Ref',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            { name: 'id', position: 0, type: UID_TYPE },
            { name: 'target', position: 1, type: ID_TYPE },
        ],
        variants: [],
    },
    [`${NORMALIZED_ABC}::example::StatusHolder`]: {
        typeName: '0xabc::example::StatusHolder',
        definingId: '0xabc',
        module: 'example',
        name: 'StatusHolder',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            {
                name: 'value',
                position: 0,
                type: {
                    type: OpenSignatureBody_Type.DATATYPE,
                    typeName: '0xabc::example::Status',
                    typeParameterInstantiation: [],
                },
            },
        ],
        variants: [],
    },
    '0xabc::example::Status': {
        typeName: '0xabc::example::Status',
        definingId: '0xabc',
        module: 'example',
        name: 'Status',
        kind: DatatypeDescriptor_DatatypeKind.ENUM,
        fields: [],
        variants: [
            {
                name: 'Active',
                position: 0,
                fields: [{ name: 'since', position: 0, type: U64_TYPE }],
            },
            { name: 'Inactive', position: 1, fields: [] },
        ],
    },
    '0xabc::example::ListBox': {
        typeName: '0xabc::example::ListBox',
        definingId: '0xabc',
        module: 'example',
        name: 'ListBox',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            {
                name: 'items',
                position: 0,
                type: {
                    type: OpenSignatureBody_Type.VECTOR,
                    typeParameterInstantiation: [
                        {
                            type: OpenSignatureBody_Type.TYPE_PARAMETER,
                            typeParameter: 0,
                            typeParameterInstantiation: [],
                        },
                    ],
                },
            },
        ],
        variants: [],
    },
    [`${NORMALIZED_ABC}::example::VectorHolder`]: {
        typeName: '0xabc::example::VectorHolder',
        definingId: '0xabc',
        module: 'example',
        name: 'VectorHolder',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            { name: 'box_bytes', position: 0, type: BOX_OF_BYTES_TYPE },
            { name: 'box_items', position: 1, type: BOX_OF_ITEMS_TYPE },
            { name: 'opt_bytes', position: 2, type: OPTION_BYTES_TYPE },
            { name: 'list_u8', position: 3, type: LIST_BOX_OF_U8_TYPE },
        ],
        variants: [],
    },
    [`${NORMALIZED_ABC}::example::Metadata`]: {
        typeName: '0xabc::example::Metadata',
        definingId: '0xabc',
        module: 'example',
        name: 'Metadata',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            { name: 'name', position: 0, type: STRING_TYPE },
            { name: 'symbol', position: 1, type: ASCII_STRING_TYPE },
            { name: 'icon_url', position: 2, type: URL_TYPE },
            { name: 'coin_type', position: 3, type: TYPE_NAME_TYPE },
            { name: 'balance', position: 4, type: BALANCE_SUI_TYPE },
            { name: 'note', position: 5, type: OPTION_U64_TYPE },
            { name: 'item', position: 6, type: OPTION_ITEM_TYPE },
            { name: 'raw', position: 7, type: BYTES_TYPE },
        ],
        variants: [],
    },
    // A generic struct whose *own* type arguments (rather than a field's declared type) are what
    // need resolving — e.g. a real dynamic-field wrapper object `0x2::dynamic_field::Field<K, V>`.
    [`${NORMALIZED_ABC}::example::Field`]: {
        typeName: '0xabc::example::Field',
        definingId: '0xabc',
        module: 'example',
        name: 'Field',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            {
                name: 'value',
                position: 0,
                type: {
                    type: OpenSignatureBody_Type.TYPE_PARAMETER,
                    typeParameter: 1,
                    typeParameterInstantiation: [],
                },
            },
        ],
        variants: [],
    },
    // Same struct as `0xabc::example::Item` above, keyed by its normalized address — a top-level
    // object type's own type arguments resolve through `TypeTagSerializer`, which (like
    // `parseStructTag`) normalizes every address it parses, including a nested one.
    [`${NORMALIZED_ABC}::example::Item`]: {
        typeName: '0xabc::example::Item',
        definingId: '0xabc',
        module: 'example',
        name: 'Item',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [{ name: 'value', position: 0, type: U64_TYPE }],
        variants: [],
    },
    [`${NORMALIZED_ABC}::example::OptionListHolder`]: {
        typeName: '0xabc::example::OptionListHolder',
        definingId: '0xabc',
        module: 'example',
        name: 'OptionListHolder',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [{ name: 'items', position: 0, type: VECTOR_OF_OPTION_U64_TYPE }],
        variants: [],
    },
    // Keyed both ways: the top-level object type resolves by its normalized address, and the
    // `next` field's own type by the address as the descriptor writes it.
    [`${NORMALIZED_ABC}::example::Loop`]: LOOP_DATATYPE,
    '0xabc::example::Loop': LOOP_DATATYPE,
    [`${NORMALIZED_ABC}::example::GrowingLoop`]: GROWING_LOOP_DATATYPE,
    '0xabc::example::GrowingLoop': GROWING_LOOP_DATATYPE,
    '0xabc::example::Pair': {
        typeName: '0xabc::example::Pair',
        definingId: '0xabc',
        module: 'example',
        name: 'Pair',
        kind: DatatypeDescriptor_DatatypeKind.STRUCT,
        fields: [
            { name: 'first', position: 0, type: TYPE_PARAMETER_0 },
            {
                name: 'second',
                position: 1,
                type: {
                    type: OpenSignatureBody_Type.TYPE_PARAMETER,
                    typeParameter: 1,
                    typeParameterInstantiation: [],
                },
            },
        ],
        variants: [],
    },
} as unknown as Record<string, GrpcTypes.DatatypeDescriptor>;

const createMockClient = (): {
    grpcClient: MovePackageGrpcClient;
    getDatatype: ReturnType<typeof vi.fn>;
} => {
    const getDatatype = vi.fn().mockImplementation(({ packageId, moduleName, name }) => {
        const key = `${packageId}::${moduleName}::${name}`;
        const datatype = DATATYPES[key];
        if (!datatype) {
            throw new Error(`no mock datatype for ${key}`);
        }
        return Promise.resolve({ response: { datatype } });
    });
    return {
        grpcClient: { movePackageService: { getDatatype } } as unknown as MovePackageGrpcClient,
        getDatatype,
    };
};

describe('renderObjectContentFields', () => {
    it('wraps a UID field and recursively re-wraps a generic nested struct field', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const result = await renderObjectContentFields(
            METHOD,
            '0xabc::example::Wrapper',
            { id: '0xdead', box: { value: { value: '42' } } },
            resolveDatatype,
        );

        expect(result).toEqual({
            id: { id: '0xdead' },
            box: {
                type: '0xabc::example::Box<0xabc::example::Item>',
                fields: {
                    value: { type: '0xabc::example::Item', fields: { value: '42' } },
                },
            },
        });
    });

    it('wraps a UID field but leaves an ID field as its bare address (e.g. UpgradeCap.package)', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const result = await renderObjectContentFields(
            METHOD,
            '0xabc::example::Ref',
            { id: '0xdead', target: '0xbeef' },
            resolveDatatype,
        );

        expect(result).toEqual({ id: { id: '0xdead' }, target: '0xbeef' });
    });

    it('wraps an enum value using its already-self-describing @variant marker', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const active = await renderObjectContentFields(
            METHOD,
            '0xabc::example::StatusHolder',
            { value: { '@variant': 'Active', since: '100' } },
            resolveDatatype,
        );
        expect(active).toEqual({
            value: { type: '0xabc::example::Status', variant: 'Active', fields: { since: '100' } },
        });
    });

    it('renders a variant with no fields as an empty fields object', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const inactive = await renderObjectContentFields(
            METHOD,
            '0xabc::example::StatusHolder',
            { value: { '@variant': 'Inactive' } },
            resolveDatatype,
        );
        expect(inactive).toEqual({
            value: { type: '0xabc::example::Status', variant: 'Inactive', fields: {} },
        });
    });

    it('throws on an unknown enum variant name instead of silently dropping fields', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        await expect(
            renderObjectContentFields(
                METHOD,
                '0xabc::example::StatusHolder',
                { value: { '@variant': 'Bogus' } },
                resolveDatatype,
            ),
        ).rejects.toThrow(/unknown Move enum variant/);
    });

    it('caches a datatype fetch across multiple references within one resolver', async () => {
        const { grpcClient, getDatatype } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        await resolveDatatype('0xabc', 'example', 'Item');
        await resolveDatatype('0xabc', 'example', 'Item');
        await resolveDatatype('0xabc', 'example', 'Item');

        expect(getDatatype).toHaveBeenCalledTimes(1);
    });
});

// Sui flattens these Move stdlib/framework wrapper types down to a bare value on the wire (see
// `isStringTag`/`isUrlTag`/`isBalanceTag`/`isOptionTag` in moveTypeLayout.ts) — confirmed against
// real mainnet objects (a Coin's `Balance`, a coin registry Currency's `String`/`Url`/`Option`).
// `TypeName` is the one exception: gRPC flattens it too, but legacy doesn't (see `isTypeNameTag`),
// so it's re-wrapped instead of expected bare below.
describe('renderObjectContentFields — well-known wrapper types', () => {
    it('flattens String/ascii::String/Url/Balance/Option/vector<u8>, and re-wraps TypeName, the same way legacy does', async () => {
        const { grpcClient, getDatatype } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        // A real TypeName string is a full 64-hex-digit address with no `0x` prefix.
        const coinType = `${normalizeSuiAddress('0x2').slice(2)}::sui::SUI`;

        const result = await renderObjectContentFields(
            METHOD,
            '0xabc::example::Metadata',
            {
                name: 'Sui',
                symbol: 'SUI',
                icon_url: 'https://example.com/icon.png',
                coin_type: coinType,
                balance: '3252120',
                note: null,
                item: { value: '42' },
                raw: toBase64(new Uint8Array([1, 2, 3])),
            },
            resolveDatatype,
        );

        expect(result).toEqual({
            name: 'Sui',
            symbol: 'SUI',
            icon_url: 'https://example.com/icon.png',
            coin_type: { type: '0x1::type_name::TypeName', fields: { name: coinType } },
            balance: '3252120',
            note: null,
            item: { type: '0xabc::example::Item', fields: { value: '42' } },
            raw: [1, 2, 3],
        });

        // Balance/String/Url/TypeName/Option (and `note`'s None, caught before dispatch) resolve
        // without a network round trip; only Metadata itself and Option<Item>'s inner Item do.
        expect(getDatatype).toHaveBeenCalledTimes(2);
    });

    it('throws rather than silently mis-rendering when Balance is not the expected u64 string', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        await expect(
            renderObjectContentFields(
                METHOD,
                '0xabc::example::Metadata',
                {
                    name: 'Sui',
                    symbol: 'SUI',
                    icon_url: '',
                    coin_type: '0x2::sui::SUI',
                    balance: 3252120,
                    note: null,
                    item: { value: '42' },
                    raw: '',
                },
                resolveDatatype,
            ),
        ).rejects.toThrow(/expected a string for Move type "u64"/);
    });

    it('throws rather than silently mis-rendering a malformed vector<u8> value', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        await expect(
            renderObjectContentFields(
                METHOD,
                '0xabc::example::Metadata',
                {
                    name: 'Sui',
                    symbol: 'SUI',
                    icon_url: '',
                    coin_type: '0x2::sui::SUI',
                    balance: '0',
                    note: null,
                    item: { value: '42' },
                    raw: [1, 2, 3],
                },
                resolveDatatype,
            ),
        ).rejects.toThrow(/expected a base64 string for a Move vector<u8> value/);
    });
});

// A vector type argument substituted in through a type parameter used to flatten to a string and
// pass its raw gRPC value straight through — wrong for `vector<u8>` (needs the byte-array
// conversion) and for `vector<SomeStruct>` (needs each element wrapped in `{type, fields}`). These
// shapes are realistic here: `Option<vector<u8>>` and `Table<_, vector<u8>>` appear in the repo's
// Move sources, and every table entry is a `Field<K, V>` struct (a generic struct substituted with
// a vector).
describe('renderObjectContentFields — vectors through a type parameter', () => {
    it('renders Option<vector<u8>>, a generic struct with T = vector<u8> or vector<SomeStruct>, and a declared vector<T> with T = u8', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const result = await renderObjectContentFields(
            METHOD,
            '0xabc::example::VectorHolder',
            {
                box_bytes: { value: toBase64(new Uint8Array([1, 2, 3])) },
                box_items: { value: [{ value: '1' }, { value: '2' }] },
                opt_bytes: toBase64(new Uint8Array([4, 5])),
                list_u8: { items: toBase64(new Uint8Array([6, 7])) },
            },
            resolveDatatype,
        );

        expect(result).toEqual({
            box_bytes: { type: '0xabc::example::Box<vector<u8>>', fields: { value: [1, 2, 3] } },
            box_items: {
                type: '0xabc::example::Box<vector<0xabc::example::Item>>',
                fields: {
                    value: [
                        { type: '0xabc::example::Item', fields: { value: '1' } },
                        { type: '0xabc::example::Item', fields: { value: '2' } },
                    ],
                },
            },
            opt_bytes: [4, 5],
            list_u8: { type: '0xabc::example::ListBox<u8>', fields: { items: [6, 7] } },
        });
    });

    it('throws rather than silently mis-rendering a malformed vector<u8> value reached through a type parameter', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        await expect(
            renderObjectContentFields(
                METHOD,
                '0xabc::example::VectorHolder',
                {
                    box_bytes: { value: [1, 2, 3] },
                    box_items: { value: [] },
                    opt_bytes: toBase64(new Uint8Array([4, 5])),
                    list_u8: { items: toBase64(new Uint8Array([6, 7])) },
                },
                resolveDatatype,
            ),
        ).rejects.toThrow(/expected a base64 string for a Move vector<u8> value/);
    });
});

// A top-level object's own type arguments (as opposed to a field's declared type, covered above)
// are parsed from the `objectType` string itself via `TypeTagSerializer` rather than resolved
// against a field descriptor — a real dynamic-field wrapper object's type is generic this way
// (`0x2::dynamic_field::Field<K, V>`).
describe('renderObjectContentFields — a generic top-level object type', () => {
    it('resolves vector<u8> substituted into a top-level type parameter (e.g. Field<K, vector<u8>>)', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const result = await renderObjectContentFields(
            METHOD,
            `${NORMALIZED_ABC}::example::Field<address,vector<u8>>`,
            { value: toBase64(new Uint8Array([9, 8, 7])) },
            resolveDatatype,
        );

        expect(result).toEqual({ value: [9, 8, 7] });
    });

    it('resolves vector<SomeStruct> substituted into a top-level type parameter (e.g. Field<K, vector<SomeStruct>>)', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const result = await renderObjectContentFields(
            METHOD,
            `${NORMALIZED_ABC}::example::Field<address,vector<${NORMALIZED_ABC}::example::Item>>`,
            { value: [{ value: '1' }, { value: '2' }] },
            resolveDatatype,
        );

        expect(result).toEqual({
            value: [
                { type: `${NORMALIZED_ABC}::example::Item`, fields: { value: '1' } },
                { type: `${NORMALIZED_ABC}::example::Item`, fields: { value: '2' } },
            ],
        });
    });
});

describe('renderObjectContentFields — an Option element inside a vector', () => {
    it('renders vector<Option<u64>>, treating a None element as null rather than throwing', async () => {
        const { grpcClient } = createMockClient();
        const resolveDatatype = createDatatypeResolver(grpcClient);

        const result = await renderObjectContentFields(
            METHOD,
            '0xabc::example::OptionListHolder',
            { items: ['1', null, '3'] },
            resolveDatatype,
        );

        expect(result).toEqual({ items: ['1', null, '3'] });
    });
});

describe('renderObjectContentFields — node-supplied recursive descriptor', () => {
    const nestNext = (levels: number): unknown => {
        let json: unknown = {};
        for (let i = 0; i < levels; i++) {
            json = { next: json };
        }
        return json;
    };

    it('throws instead of recursing without bound when a struct declares a field of its own type', async () => {
        const { grpcClient } = createMockClient();

        await expect(
            renderObjectContentFields(
                METHOD,
                '0xabc::example::Loop',
                nestNext(1_000),
                createDatatypeResolver(grpcClient),
            ),
        ).rejects.toThrow(/Move value nested deeper than/);
    });

    it('throws before writing out a type that doubles in size at every level', async () => {
        const { grpcClient } = createMockClient();

        const start = performance.now();
        await expect(
            renderObjectContentFields(
                METHOD,
                '0xabc::example::GrowingLoop<u64>',
                nestNext(24),
                createDatatypeResolver(grpcClient),
            ),
        ).rejects.toThrow(/Move type has more than 512 type nodes/);
        expect(performance.now() - start).toBeLessThan(500);
    });
});
