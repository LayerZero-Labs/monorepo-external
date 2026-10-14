/**
 * Copied over from OFT generated types but should work for oapp
 * as long as they follow the same conventions
 */

import type { Context, Pda, PublicKey, Signer, TransactionBuilder } from '@metaplex-foundation/umi';
import type { Option, OptionOrNullable } from '@metaplex-foundation/umi';
import { transactionBuilder } from '@metaplex-foundation/umi';
import type { GetDataEnumKindContent, Serializer } from '@metaplex-foundation/umi/serializers';
import {
    bytes,
    dataEnum,
    mapSerializer,
    option,
    struct,
    tuple,
    u16,
    u32,
    u64,
} from '@metaplex-foundation/umi/serializers';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';

import type { ResolvedAccount, ResolvedAccountsWithIndices } from './shared';
import { getAccountMetasAndSigners } from './shared';

export type RateLimitParams = {
    refillPerSecond: Option<bigint>;
    capacity: Option<bigint>;
};

export type RateLimitParamsArgs = {
    refillPerSecond: OptionOrNullable<number | bigint>;
    capacity: OptionOrNullable<number | bigint>;
};

export function getRateLimitParamsSerializer(): Serializer<RateLimitParamsArgs, RateLimitParams> {
    return struct<RateLimitParams>(
        [
            ['refillPerSecond', option(u64())],
            ['capacity', option(u64())],
        ],
        { description: 'RateLimitParams' },
    ) as Serializer<RateLimitParamsArgs, RateLimitParams>;
}

export type PeerConfigParam =
    | { __kind: 'PeerAddress'; fields: [Uint8Array] }
    | { __kind: 'FeeBps'; fields: [Option<number>] }
    | { __kind: 'EnforcedOptions'; send: Uint8Array; sendAndCall: Uint8Array }
    | { __kind: 'OutboundRateLimit'; fields: [Option<RateLimitParams>] }
    | { __kind: 'InboundRateLimit'; fields: [Option<RateLimitParams>] };

export type PeerConfigParamArgs =
    | { __kind: 'PeerAddress'; fields: [Uint8Array] }
    | { __kind: 'FeeBps'; fields: [OptionOrNullable<number>] }
    | { __kind: 'EnforcedOptions'; send: Uint8Array; sendAndCall: Uint8Array }
    | {
          __kind: 'OutboundRateLimit';
          fields: [OptionOrNullable<RateLimitParamsArgs>];
      }
    | {
          __kind: 'InboundRateLimit';
          fields: [OptionOrNullable<RateLimitParamsArgs>];
      };

export function getPeerConfigParamSerializer(): Serializer<PeerConfigParamArgs, PeerConfigParam> {
    return dataEnum<PeerConfigParam>(
        [
            [
                'PeerAddress',
                struct<GetDataEnumKindContent<PeerConfigParam, 'PeerAddress'>>([
                    ['fields', tuple([bytes({ size: 32 })])],
                ]),
            ],
            [
                'FeeBps',
                struct<GetDataEnumKindContent<PeerConfigParam, 'FeeBps'>>([
                    ['fields', tuple([option(u16())])],
                ]),
            ],
            [
                'EnforcedOptions',
                struct<GetDataEnumKindContent<PeerConfigParam, 'EnforcedOptions'>>([
                    ['send', bytes({ size: u32() })],
                    ['sendAndCall', bytes({ size: u32() })],
                ]),
            ],
            [
                'OutboundRateLimit',
                struct<GetDataEnumKindContent<PeerConfigParam, 'OutboundRateLimit'>>([
                    ['fields', tuple([option(getRateLimitParamsSerializer())])],
                ]),
            ],
            [
                'InboundRateLimit',
                struct<GetDataEnumKindContent<PeerConfigParam, 'InboundRateLimit'>>([
                    ['fields', tuple([option(getRateLimitParamsSerializer())])],
                ]),
            ],
        ],
        { description: 'PeerConfigParam' },
    ) as Serializer<PeerConfigParamArgs, PeerConfigParam>;
}

// Accounts.
export type SetPeerConfigInstructionAccounts = {
    admin: Signer;
    peer: PublicKey | Pda;
    oftStore: PublicKey | Pda;
    systemProgram?: PublicKey | Pda;
};

// Data.
export type SetPeerConfigInstructionData = {
    discriminator: Uint8Array;
    remoteEid: number;
    config: PeerConfigParam;
};

export type SetPeerConfigInstructionDataArgs = {
    remoteEid: number;
    config: PeerConfigParamArgs;
};

export function getSetPeerConfigInstructionDataSerializer(): Serializer<
    SetPeerConfigInstructionDataArgs,
    SetPeerConfigInstructionData
> {
    return mapSerializer<SetPeerConfigInstructionDataArgs, any, SetPeerConfigInstructionData>(
        struct<SetPeerConfigInstructionData>(
            [
                ['discriminator', bytes({ size: 8 })],
                ['remoteEid', u32()],
                ['config', getPeerConfigParamSerializer()],
            ],
            { description: 'SetPeerConfigInstructionData' },
        ),
        (value) => ({
            ...value,
            discriminator: new Uint8Array([79, 187, 168, 57, 139, 140, 93, 47]),
        }),
    ) as Serializer<SetPeerConfigInstructionDataArgs, SetPeerConfigInstructionData>;
}

// Args.
export type SetPeerConfigInstructionArgs = SetPeerConfigInstructionDataArgs;

// Instruction.
export function setPeerConfig(
    context: Pick<Context, 'programs'>,
    input: SetPeerConfigInstructionAccounts & SetPeerConfigInstructionArgs,
): TransactionBuilder {
    // Program ID.
    const programId = context.programs.getPublicKey('oft', '');

    // Accounts.
    const resolvedAccounts = {
        admin: {
            index: 0,
            isWritable: true as boolean,
            value: input.admin ?? null,
        },
        peer: { index: 1, isWritable: true as boolean, value: input.peer ?? null },
        oftStore: {
            index: 2,
            isWritable: false as boolean,
            value: input.oftStore ?? null,
        },
        systemProgram: {
            index: 3,
            isWritable: false as boolean,
            value: input.systemProgram ?? null,
        },
    } satisfies ResolvedAccountsWithIndices;

    // Arguments.
    const resolvedArgs: SetPeerConfigInstructionArgs = { ...input };

    // Default values.
    if (!resolvedAccounts.systemProgram.value) {
        resolvedAccounts.systemProgram.value = context.programs.getPublicKey(
            'splSystem',
            '11111111111111111111111111111111',
        );
        resolvedAccounts.systemProgram.isWritable = false;
    }

    // Accounts in order.
    const orderedAccounts: ResolvedAccount[] = Object.values(resolvedAccounts).sort(
        (a, b) => a.index - b.index,
    );

    // Keys and Signers.
    const [keys, signers] = getAccountMetasAndSigners(orderedAccounts, 'programId', programId);

    // Data.
    const data = getSetPeerConfigInstructionDataSerializer().serialize(
        resolvedArgs as SetPeerConfigInstructionDataArgs,
    );

    // Bytes Created On Chain.
    const bytesCreatedOnChain = 0;

    return transactionBuilder([
        { instruction: { keys, programId, data }, signers, bytesCreatedOnChain },
    ]);
}

export function getSetPeerConfigInstructions(
    context: Pick<Context, 'programs'>,
    input: SetPeerConfigInstructionAccounts & SetPeerConfigInstructionArgs,
) {
    const transactionBuilder = setPeerConfig(context, input);
    const instructions = transactionBuilder.getInstructions();
    return instructions.map((instruction) => toWeb3JsInstruction(instruction));
}
