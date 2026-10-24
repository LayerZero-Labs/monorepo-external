import type { Commitment, PublicKey, RpcInterface } from '@metaplex-foundation/umi';
import { publicKeyBytes } from '@metaplex-foundation/umi';
import type { Serializer } from '@metaplex-foundation/umi/serializers';
import {
    bytes,
    Endian,
    mapSerializer,
    publicKey as publicKeySerializer,
    struct,
    u32,
    u64,
} from '@metaplex-foundation/umi/serializers';
import { fromWeb3JsPublicKey, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import * as web3 from '@solana/web3.js';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import type { Packet } from '@layerzerolabs/protocol-codecs-v2';
import { addressToBytes32 } from '@layerzerolabs/protocol-codecs-v2';

import { EDDSA } from './pda';
import { instructionDiscriminator, simulateWeb3JsTransaction, toWeb3Connection } from './utility';

// Data.
export interface NextNonceInstructionData {
    discriminator: Uint8Array;
    srcEid: number;
    sender: Uint8Array;
    receiver: PublicKey;
}

export interface NextNonceInstructionDataArgs {
    srcEid: number;
    sender: Uint8Array;
    receiver: PublicKey;
}

export function getNextNonceInstructionDataSerializer(): Serializer<
    NextNonceInstructionDataArgs,
    NextNonceInstructionData
> {
    return mapSerializer<NextNonceInstructionDataArgs, any, NextNonceInstructionData>(
        struct<NextNonceInstructionData>(
            [
                ['discriminator', bytes({ size: 8 })],
                ['srcEid', u32()],
                ['sender', bytes({ size: 32 })],
                ['receiver', publicKeySerializer()],
            ],
            { description: 'NextNonceInstructionData' },
        ),
        (value) => ({
            ...value,
            discriminator: instructionDiscriminator('next_nonce'),
        }),
    );
}

export async function nextNonce(
    rpc: RpcInterface | web3.Connection,
    payer: PublicKey | web3.PublicKey,
    packet: Pick<Packet, 'sender' | 'srcEid' | 'receiver'>,
    commitment: Commitment = 'confirmed',
): Promise<bigint> {
    const { sender: sender_, srcEid, receiver: receiver_ } = packet;
    const receiver = new web3.PublicKey(addressToBytes32(receiver_));
    const connection = toWeb3Connection(rpc);
    const receiverInfo = await connection.getAccountInfo(receiver);
    if (receiverInfo === null) {
        throw new Error(`Receiver account not found: ${receiver.toBase58()}`);
    }

    const params: NextNonceInstructionDataArgs = {
        srcEid: srcEid,
        sender: hexToBytes(sender_),
        receiver: fromWeb3JsPublicKey(receiver),
    };
    const receiverProgram = receiverInfo.owner;

    const [nonceAccount] = EDDSA.findPda(fromWeb3JsPublicKey(receiverProgram), [
        Buffer.from('Nonce', 'utf8'),
        publicKeyBytes(params.receiver),
        u32({ endian: Endian.Big }).serialize(srcEid),
        params.sender,
    ]);
    const accounts: web3.AccountMeta[] = [
        {
            pubkey: receiver,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: toWeb3JsPublicKey(nonceAccount),
            isSigner: false,
            isWritable: true,
        },
    ];
    const nextNonceIx: web3.TransactionInstruction = {
        programId: receiverProgram,
        keys: accounts,
        data: Buffer.from(getNextNonceInstructionDataSerializer().serialize(params)),
    };
    return simulateWeb3JsTransaction(
        connection,
        [nextNonceIx],
        receiverProgram,
        payer,
        u64(),
        commitment,
    );
}
