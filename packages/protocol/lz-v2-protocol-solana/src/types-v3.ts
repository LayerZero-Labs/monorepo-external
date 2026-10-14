/**
 * Executor V3 (`lz_{receive,compose}_types_v3`) wire types. They differ from the V2 types in
 * `./types`: the account locator has no lookup-table variant, so its Borsh tags differ.
 */
import type { PublicKey } from '@metaplex-foundation/umi';
import type {
    GetDataEnumKind,
    GetDataEnumKindContent,
    Serializer,
} from '@metaplex-foundation/umi/serializers';
import {
    array,
    bool,
    bytes,
    dataEnum,
    publicKey as publicKeySerializer,
    struct,
    tuple,
    u8,
    u32,
    unit,
} from '@metaplex-foundation/umi/serializers';

export interface LzReceiveTypesV3Accounts {
    accounts: PublicKey[];
}

export interface LzComposeTypesV3Accounts {
    accounts: PublicKey[];
}

export type AddressLocatorV3 =
    | { __kind: 'Address'; fields: [PublicKey] }
    | { __kind: 'Payer' }
    | { __kind: 'Signer'; fields: [number] }
    | { __kind: 'Context' };

export interface AccountMetaRefV3 {
    pubkey: AddressLocatorV3;
    isWritable: boolean;
}

export type InstructionForLzReceiveV3 =
    | { __kind: 'LzReceive'; accounts: AccountMetaRefV3[] }
    | { __kind: 'Standard'; programId: PublicKey; accounts: AccountMetaRefV3[]; data: Uint8Array };

export type InstructionForLzComposeV3 =
    | { __kind: 'LzCompose'; accounts: AccountMetaRefV3[] }
    | { __kind: 'Standard'; programId: PublicKey; accounts: AccountMetaRefV3[]; data: Uint8Array };

export interface LzReceiveTypesV3Result {
    contextVersion: number;
    instructions: InstructionForLzReceiveV3[];
}

export interface LzComposeTypesV3Result {
    contextVersion: number;
    instructions: InstructionForLzComposeV3[];
}

export function getAddressLocatorV3Serializer(): Serializer<AddressLocatorV3, AddressLocatorV3> {
    return dataEnum<AddressLocatorV3>(
        [
            [
                'Address',
                struct<GetDataEnumKindContent<AddressLocatorV3, 'Address'>>([
                    ['fields', tuple([publicKeySerializer()])],
                ]),
            ],
            ['Payer', unit()],
            [
                'Signer',
                struct<GetDataEnumKindContent<AddressLocatorV3, 'Signer'>>([
                    ['fields', tuple([u8()])],
                ]),
            ],
            ['Context', unit()],
        ],
        { description: 'AddressLocatorV3' },
    );
}

export function getAccountMetaRefV3Serializer(): Serializer<AccountMetaRefV3, AccountMetaRefV3> {
    return struct<AccountMetaRefV3>(
        [
            ['pubkey', getAddressLocatorV3Serializer()],
            ['isWritable', bool()],
        ],
        { description: 'AccountMetaRefV3' },
    );
}

export function getInstructionForLzReceiveV3Serializer(): Serializer<
    InstructionForLzReceiveV3,
    InstructionForLzReceiveV3
> {
    return dataEnum<InstructionForLzReceiveV3>(
        [
            [
                'LzReceive',
                struct<GetDataEnumKindContent<InstructionForLzReceiveV3, 'LzReceive'>>([
                    ['accounts', array(getAccountMetaRefV3Serializer())],
                ]),
            ],
            [
                'Standard',
                struct<GetDataEnumKindContent<InstructionForLzReceiveV3, 'Standard'>>([
                    ['programId', publicKeySerializer()],
                    ['accounts', array(getAccountMetaRefV3Serializer())],
                    ['data', bytes({ size: u32() })],
                ]),
            ],
        ],
        { description: 'Instruction' },
    );
}

export function getInstructionForLzComposeV3Serializer(): Serializer<
    InstructionForLzComposeV3,
    InstructionForLzComposeV3
> {
    return dataEnum<InstructionForLzComposeV3>(
        [
            [
                'LzCompose',
                struct<GetDataEnumKindContent<InstructionForLzComposeV3, 'LzCompose'>>([
                    ['accounts', array(getAccountMetaRefV3Serializer())],
                ]),
            ],
            [
                'Standard',
                struct<GetDataEnumKindContent<InstructionForLzComposeV3, 'Standard'>>([
                    ['programId', publicKeySerializer()],
                    ['accounts', array(getAccountMetaRefV3Serializer())],
                    ['data', bytes({ size: u32() })],
                ]),
            ],
        ],
        { description: 'Instruction' },
    );
}
export function getLzReceiveTypesV3ResultSerializer(): Serializer<
    LzReceiveTypesV3Result,
    LzReceiveTypesV3Result
> {
    return struct<LzReceiveTypesV3Result>(
        [
            ['contextVersion', u8()],
            ['instructions', array(getInstructionForLzReceiveV3Serializer())],
        ],
        { description: 'LzReceiveTypesV3Result' },
    );
}

export function getLzComposeTypesV3ResultSerializer(): Serializer<
    LzComposeTypesV3Result,
    LzComposeTypesV3Result
> {
    return struct<LzComposeTypesV3Result>(
        [
            ['contextVersion', u8()],
            ['instructions', array(getInstructionForLzComposeV3Serializer())],
        ],
        { description: 'LzComposeTypesV3Result' },
    );
}

// Data Enum Helpers.
export function addressLocatorV3(kind: 'Payer'): GetDataEnumKind<AddressLocatorV3, 'Payer'>;

export function addressLocatorV3(
    kind: 'Signer',
    data: GetDataEnumKindContent<AddressLocatorV3, 'Signer'>['fields'],
): GetDataEnumKind<AddressLocatorV3, 'Signer'>;

export function addressLocatorV3(
    kind: 'Address',
    data: GetDataEnumKindContent<AddressLocatorV3, 'Address'>['fields'],
): GetDataEnumKind<AddressLocatorV3, 'Address'>;

export function addressLocatorV3<K extends AddressLocatorV3['__kind']>(
    kind: K,

    data?: any,
): Extract<AddressLocatorV3, { __kind: K }> {
    return Array.isArray(data)
        ? ({ __kind: kind, fields: data } as Extract<AddressLocatorV3, { __kind: K }>)
        : ({ __kind: kind, ...(data ?? {}) } as Extract<AddressLocatorV3, { __kind: K }>);
}

export function isAddressLocatorV3<K extends AddressLocatorV3['__kind']>(
    kind: K,
    value: AddressLocatorV3,
): value is AddressLocatorV3 & { __kind: K } {
    return value.__kind === kind;
}
