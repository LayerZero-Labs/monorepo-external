import type { AccountMeta, Commitment, PublicKey, RpcInterface } from '@metaplex-foundation/umi';
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
    u16,
    u32,
    u64,
    unit,
} from '@metaplex-foundation/umi/serializers';

export interface SolanaPacketPath {
    sender: PublicKey;
    dstEid: number;
    receiver: Uint8Array; // length 32
}

/**
 * Offset for message type.
 */
export const MSG_TYPE_OFFSET = 0;

/**
 * Enum representing different message types.
 */
export enum MessageType {
    /**
     * Vanilla message type.
     */
    VANILLA = 1,

    /**
     * Composed message type.
     */
    COMPOSED_TYPE = 2,

    /**
     * ABA message type.
     */
    ABA = 3,
}

/**
 * Interface representing the parameters for LzReceive.
 */
export interface LzReceiveParams {
    /**
     * Source EID.
     */
    srcEid: number;
    /**
     * Sender address (size: 32).
     */
    sender: Uint8Array;

    nonce: bigint;

    /**
     * GUID (size: 32).
     */
    guid: Uint8Array;

    /**
     * Message content.
     */
    message: Uint8Array;

    /**
     * Caller parameters.
     */
    callerParams: Uint8Array;
}

export interface LzReceiveParamsArgs {
    srcEid: number;
    sender: Uint8Array;
    nonce: number | bigint;
    guid: Uint8Array;
    message: Uint8Array;
    callerParams: Uint8Array;
}

export function getLzReceiveParamsSerializer(): Serializer<LzReceiveParamsArgs, LzReceiveParams> {
    return struct<LzReceiveParams>(
        [
            ['srcEid', u32()],
            ['sender', bytes({ size: 32 })],
            ['nonce', u64()],
            ['guid', bytes({ size: 32 })],
            ['message', bytes({ size: u32() })],
            ['callerParams', bytes({ size: u32() })],
        ],
        { description: 'LzReceiveParams' },
    ) as Serializer<LzReceiveParamsArgs, LzReceiveParams>;
}

/**
 *
pub from: Pubkey,
pub to: Pubkey,
pub guid: [u8; 32],
pub index: u16,
pub message: Vec<u8>,
pub extra_data: Vec<u8>,
**/

/**
 * Interface representing the parameters for LzCompose.
 */
export interface LzComposeParams {
    /**
     * Sender public key.
     */
    from: PublicKey;

    /**
     * Recipient public key.
     */
    to: PublicKey;

    /**
     * GUID (size: 32).
     */
    guid: Uint8Array;

    /**
     * Index value.
     */
    index: number;

    /**
     * Message content.
     */
    message: Uint8Array;

    /**
     * Extra data.
     */
    extraData: Uint8Array;
}

export function getLzComposeParamsSerializer(): Serializer<LzComposeParams, LzComposeParams> {
    return struct<LzComposeParams>(
        [
            ['from', publicKeySerializer()],
            ['to', publicKeySerializer()],
            ['guid', bytes({ size: 32 })],
            ['index', u16()],
            ['message', bytes({ size: u32() })],
            ['extraData', bytes({ size: u32() })],
        ],
        { description: 'LzComposeParams' },
    );
}

/**
 * Interface representing an LzReceive account.
 */
export interface LzReceiveAccount {
    /**
     * Public key of the account.
     */
    pubkey: PublicKey;

    /**
     * Indicates if the account is a signer.
     */
    isSigner: boolean;

    /**
     * Indicates if the account is writable.
     */
    isWritable: boolean;
}

export function getLzReceiveAccountSerializer(): Serializer<LzReceiveAccount, LzReceiveAccount> {
    return struct<LzReceiveAccount>(
        [
            ['pubkey', publicKeySerializer()],
            ['isSigner', bool()],
            ['isWritable', bool()],
        ],
        { description: 'LzReceiveAccount' },
    );
}

/**
 * Enum representing different executor option types.
 */
export enum ExecutorOptionType {
    /**
     * Placeholder option type.
     */
    PlaceHolder = 0,

    /**
     * LzReceive option type.
     */
    LzReceive = 1,

    /**
     * NativeDrop option type.
     */
    NativeDrop = 2,

    /**
     * LzCompose option type.
     */
    LzCompose = 3,

    /**
     * OrderExecution option type.
     */
    OrderExecution = 4,
}

/**
 * Maximum length for executor option types.
 */
export const MaxExecutorOptionTypeLength = 10;

export interface LzReceiveTypesV2Accounts {
    accounts: PublicKey[];
}

export interface LzComposeTypesV2Accounts {
    accounts: PublicKey[];
}

export type AddressLocator =
    | { __kind: 'Address'; fields: [PublicKey] }
    | { __kind: 'AltIndex'; fields: [number, number] }
    | { __kind: 'Payer' }
    | { __kind: 'Signer'; fields: [number] }
    | { __kind: 'Context' };

export interface AccountMetaRef {
    pubkey: AddressLocator;
    isWritable: boolean;
}

export type InstructionForLzReceive =
    | { __kind: 'LzReceive'; accounts: AccountMetaRef[] }
    | { __kind: 'Standard'; programId: PublicKey; accounts: AccountMetaRef[]; data: Uint8Array };

export type InstructionForLzCompose =
    | { __kind: 'LzCompose'; accounts: AccountMetaRef[] }
    | { __kind: 'Standard'; programId: PublicKey; accounts: AccountMetaRef[]; data: Uint8Array };

export interface LzReceiveTypesV2Result {
    contextVersion: number;
    alts: PublicKey[];
    instructions: InstructionForLzReceive[];
}

export interface LzComposeTypesV2Result {
    contextVersion: number;
    alts: PublicKey[];
    instructions: InstructionForLzCompose[];
}

export function getAddressLocatorSerializer(): Serializer<AddressLocator, AddressLocator> {
    return dataEnum<AddressLocator>(
        [
            [
                'Address',
                struct<GetDataEnumKindContent<AddressLocator, 'Address'>>([
                    ['fields', tuple([publicKeySerializer()])],
                ]),
            ],
            [
                'AltIndex',
                struct<GetDataEnumKindContent<AddressLocator, 'AltIndex'>>([
                    ['fields', tuple([u8(), u8()])],
                ]),
            ],
            ['Payer', unit()],
            [
                'Signer',
                struct<GetDataEnumKindContent<AddressLocator, 'Signer'>>([
                    ['fields', tuple([u8()])],
                ]),
            ],
            ['Context', unit()],
        ],
        { description: 'AddressLocator' },
    );
}

export function getLzReceiveTypesV2AccountsSerializer(): Serializer<
    LzReceiveTypesV2Accounts,
    LzReceiveTypesV2Accounts
> {
    return struct<LzReceiveTypesV2Accounts>([['accounts', array(publicKeySerializer())]], {
        description: 'LzReceiveTypesV2Result',
    });
}

export function getLzComposeTypesV2AccountsSerializer(): Serializer<
    LzComposeTypesV2Accounts,
    LzComposeTypesV2Accounts
> {
    return struct<LzComposeTypesV2Accounts>([['accounts', array(publicKeySerializer())]], {
        description: 'LzComposeTypesV2Accounts',
    });
}

export function getAccountMetaRefSerializer(): Serializer<AccountMetaRef, AccountMetaRef> {
    return struct<AccountMetaRef>(
        [
            ['pubkey', getAddressLocatorSerializer()],
            ['isWritable', bool()],
        ],
        { description: 'AccountMetaRef' },
    );
}

export function getInstructionForLzReceiveSerializer(): Serializer<
    InstructionForLzReceive,
    InstructionForLzReceive
> {
    return dataEnum<InstructionForLzReceive>(
        [
            [
                'LzReceive',
                struct<GetDataEnumKindContent<InstructionForLzReceive, 'LzReceive'>>([
                    ['accounts', array(getAccountMetaRefSerializer())],
                ]),
            ],
            [
                'Standard',
                struct<GetDataEnumKindContent<InstructionForLzReceive, 'Standard'>>([
                    ['programId', publicKeySerializer()],
                    ['accounts', array(getAccountMetaRefSerializer())],
                    ['data', bytes({ size: u32() })],
                ]),
            ],
        ],
        { description: 'Instruction' },
    );
}

export function getInstructionForLzComposeSerializer(): Serializer<
    InstructionForLzCompose,
    InstructionForLzCompose
> {
    return dataEnum<InstructionForLzCompose>(
        [
            [
                'LzCompose',
                struct<GetDataEnumKindContent<InstructionForLzCompose, 'LzCompose'>>([
                    ['accounts', array(getAccountMetaRefSerializer())],
                ]),
            ],
            [
                'Standard',
                struct<GetDataEnumKindContent<InstructionForLzCompose, 'Standard'>>([
                    ['programId', publicKeySerializer()],
                    ['accounts', array(getAccountMetaRefSerializer())],
                    ['data', bytes({ size: u32() })],
                ]),
            ],
        ],
        { description: 'Instruction' },
    );
}
export function getLzReceiveTypesV2ResultSerializer(): Serializer<
    LzReceiveTypesV2Result,
    LzReceiveTypesV2Result
> {
    return struct<LzReceiveTypesV2Result>(
        [
            ['contextVersion', u8()],
            ['alts', array(publicKeySerializer())],
            ['instructions', array(getInstructionForLzReceiveSerializer())],
        ],
        { description: 'LzReceiveTypesV2Result' },
    );
}

export function getLzComposeTypesV2ResultSerializer(): Serializer<
    LzComposeTypesV2Result,
    LzComposeTypesV2Result
> {
    return struct<LzComposeTypesV2Result>(
        [
            ['contextVersion', u8()],
            ['alts', array(publicKeySerializer())],
            ['instructions', array(getInstructionForLzComposeSerializer())],
        ],
        { description: 'LzComposeTypesV2Result' },
    );
}

// Data Enum Helpers.
export function addressLocator(kind: 'Payer'): GetDataEnumKind<AddressLocator, 'Payer'>;

export function addressLocator(
    kind: 'Signer',
    data: GetDataEnumKindContent<AddressLocator, 'Signer'>['fields'],
): GetDataEnumKind<AddressLocator, 'Signer'>;

export function addressLocator(
    kind: 'Address',
    data: GetDataEnumKindContent<AddressLocator, 'Address'>['fields'],
): GetDataEnumKind<AddressLocator, 'Address'>;

export function addressLocator(
    kind: 'AltIndex',
    data: GetDataEnumKindContent<AddressLocator, 'AltIndex'>['fields'],
): GetDataEnumKind<AddressLocator, 'AltIndex'>;

export function addressLocator<K extends AddressLocator['__kind']>(
    kind: K,

    data?: any,
): Extract<AddressLocator, { __kind: K }> {
    return Array.isArray(data)
        ? ({ __kind: kind, fields: data } as Extract<AddressLocator, { __kind: K }>)
        : ({ __kind: kind, ...(data ?? {}) } as Extract<AddressLocator, { __kind: K }>);
}

export function isAddressLocator<K extends AddressLocator['__kind']>(
    kind: K,
    value: AddressLocator,
): value is AddressLocator & { __kind: K } {
    return value.__kind === kind;
}

export interface SetPeerAddressParam {
    peer: Uint8Array;
    __kind: 'PeerAddress';
}

export interface SetPeerFeeBpsParam {
    feeBps: number;
    __kind: 'FeeBps';
}

export interface SetPeerEnforcedOptionsParam {
    send: Uint8Array;
    sendAndCall: Uint8Array;
    __kind: 'EnforcedOptions';
}

export interface SetPeerRateLimitParam {
    rateLimit?: {
        refillPerSecond: bigint;
        capacity: bigint;
    };
    __kind: 'OutboundRateLimit' | 'InboundRateLimit';
}

export interface SetPeerIsEndpointV1Param {
    isEndpointV1: boolean;
    __kind: 'IsEndpointV1';
}

export interface SetOFTConfigParams {
    __kind: 'Admin' | 'Delegate' | 'DefaultFee' | 'Paused' | 'Pauser' | 'Unpauser';
    admin?: PublicKey;
    delegate?: PublicKey;
    defaultFee?: number;
    paused?: boolean;
    pauser?: PublicKey;
    unpauser?: PublicKey;
}

/**
 * Enum representing different configuration types.
 */
export enum SetConfigType {
    /**
     * Executor configuration type.
     */
    EXECUTOR = 1,

    /**
     * Send ULN configuration type.
     */
    SEND_ULN = 2,

    /**
     * Receive ULN configuration type.
     */
    RECEIVE_ULN = 3,
}

/**
 * Interface representing the Message Library.
 */
export interface MessageLibInterface {
    programId: PublicKey;

    /**
     * Gets the account metadata for a quote instruction.
     *
     * @param {Connection} connection - The Solana connection.
     * @param {PublicKey} payer - The payer public key.
     * @param {PacketPath} path - The packet path.
     * @param {Commitment} [commitment] - The commitment level.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     */
    getQuoteIXAccountMetaForCPI(
        rpc: RpcInterface,
        payer: PublicKey,
        path: SolanaPacketPath,
        commitment?: Commitment,
    ): Promise<AccountMeta[]>;

    getSendIXAccountMetaForCPI(
        rpc: RpcInterface,
        payer: PublicKey,
        path: SolanaPacketPath,
    ): Promise<AccountMeta[]>;

    getSendWithLzTokenIXAccountMetaForCPI(
        rpc: RpcInterface,
        accounts: {
            payer: PublicKey;
            tokenMint: PublicKey;
            tokenSource: PublicKey;
        },
        path: SolanaPacketPath,
        programs: {
            tokenProgram?: PublicKey;
            associatedTokenProgram?: PublicKey;
        },
        commitment: Commitment,
    ): Promise<AccountMeta[]>;
    /**
     * Gets the account metadata for an init config instruction.
     *
     * @param {PublicKey} payer - The payer public key.
     * @param {PublicKey} oappID - The OAPP ID.
     * @param {number} eid - The endpoint ID.
     * @returns {AccountMeta[]} An array of account metadata.
     */
    getInitConfigIXAccountMetaForCPI(payer: PublicKey, oapp: PublicKey, eid: number): AccountMeta[];

    /**
     * Gets the account metadata for a set config instruction.
     *
     * @param {PublicKey} endpointProgram - The endpoint program public key.
     * @param {PublicKey} oappID - The OAPP ID.
     * @param {number} eid - The endpoint ID.
     * @returns {Promise<AccountMeta[]>} A promise that resolves to an array of account metadata.
     */
    getSetConfigIXAccountMetaForCPI(
        oapp: PublicKey,
        eid: number,
        endpointProgram?: PublicKey,
    ): AccountMeta[];
}
