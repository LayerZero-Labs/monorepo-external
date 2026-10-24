import type { Commitment, Instruction, PublicKey, RpcInterface } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';
import invariant from 'tiny-invariant';

import { hexToBytes } from '@layerzerolabs/common-encoding-utils';
import type { Packet } from '@layerzerolabs/protocol-codecs-v2';
import { addressToBytes32 } from '@layerzerolabs/protocol-codecs-v2';

import { getLzComposeAccountsFromTypesV1 } from './compose-types-v1';
import { buildLzComposeExecutionPlan, getLzComposeTypesInfo } from './compose-types-v2';
import type { ComposeSentEvent } from './generated/endpoint/events';
import { EXECUTOR_PROGRAM_ID } from './generated/executor/programs';
import { getLzReceiveAccountsFromTypesV1 } from './receive-types-v1';
import { buildLzReceiveExecutionPlan, getLzReceiveTypesInfo } from './receive-types-v2';
import type {
    LzComposeParams,
    LzComposeTypesV2Accounts,
    LzReceiveParams,
    LzReceiveTypesV2Accounts,
} from './types';
import { getLzComposeParamsSerializer, getLzReceiveParamsSerializer } from './types';
import { instructionDiscriminator } from './utility';

/**
 * Unified entry point for receiving a LayerZero message on Solana.
 * This function automatically detects the lz_receive_types version and dispatches to the correct logic.
 *
 * For V1: returns a single Instruction (legacy behavior).
 * For V2: returns { signers, instructions } for multi-instruction atomic execution.
 */
export async function lzReceive(
    rpc: RpcInterface,
    payer: PublicKey,
    packet: Pick<Packet, 'message' | 'sender' | 'srcEid' | 'guid' | 'receiver' | 'nonce'>,
    callerParams: Uint8Array = Uint8Array.from([0, 0]),
    executorProgram: PublicKey = EXECUTOR_PROGRAM_ID,
    commitment: Commitment = 'confirmed',
): Promise<
    | { instruction: Instruction; contextVersion: number }
    | ReturnType<typeof buildLzReceiveExecutionPlan>
> {
    const { message: message_, sender: sender_, srcEid, guid, receiver: receiver_, nonce } = packet;
    const sender = hexToBytes(sender_);
    const receiverBytes = addressToBytes32(receiver_);
    const message = hexToBytes(message_);
    const params: LzReceiveParams = {
        srcEid: srcEid,
        sender,
        guid: hexToBytes(guid),
        message,
        callerParams,
        nonce: BigInt(nonce),
    };
    const receiverPubkey = publicKey(receiverBytes);
    const receiverInfo = await rpc.getAccount(receiverPubkey, { commitment });
    invariant(receiverInfo.exists, `Receiver account not found: ${receiverPubkey}`);
    const receiverProgram = publicKey(receiverInfo.owner);

    // Try to detect version by calling lz_receive_types_info
    let version = 1;
    let receiveTypesAccounts: LzReceiveTypesV2Accounts | undefined;
    try {
        // V2: lz_receive_types_info returns version 2
        receiveTypesAccounts = await getLzReceiveTypesInfo(
            rpc,
            payer,
            receiverPubkey,
            receiverProgram,
            params,
            commitment,
        );
        version = 2;
    } catch (e) {
        // If info call fails or version !== 2, fallback to V1
        version = 1;
    }

    if (version === 2) {
        return buildLzReceiveExecutionPlan(
            rpc,
            executorProgram,
            payer,
            receiverPubkey,
            receiverProgram,
            params,
            receiveTypesAccounts,
            commitment,
        );
    } else {
        // V1: return a single Instruction (legacy behavior)
        const accounts = await getLzReceiveAccountsFromTypesV1(
            rpc,
            payer,
            receiverPubkey,
            receiverProgram,
            params,
            commitment,
        );
        const data = getLzReceiveParamsSerializer().serialize(params);
        return {
            instruction: {
                programId: receiverProgram,
                keys: accounts,
                data: Buffer.concat([instructionDiscriminator('lz_receive'), data]),
            },
            contextVersion: 1,
        };
    }
}

/**
 * Unified entry point for composing a LayerZero message on Solana.
 * This function automatically detects the lz_compose_types version and dispatches to the correct logic.
 *
 * For V1: returns a single Instruction (legacy behavior).
 * For V2: returns { signers, instructions } for multi-instruction atomic execution.
 */
export async function lzCompose(
    rpc: RpcInterface,
    payer: PublicKey,
    event: ComposeSentEvent,
    extraData: Uint8Array = Uint8Array.from([0, 0]),
    executorProgram: PublicKey = EXECUTOR_PROGRAM_ID,
    commitment: Commitment = 'confirmed',
): Promise<
    | { instruction: Instruction; contextVersion: number }
    | ReturnType<typeof buildLzComposeExecutionPlan>
> {
    const { to, from, guid, index, message } = event;
    const params: LzComposeParams = {
        from,
        to,
        guid,
        index,
        message,
        extraData,
    };
    const accountInfo = await rpc.getAccount(to, { commitment });
    if (!accountInfo.exists) {
        throw new Error(`Account not found: ${to}`);
    }
    const composerProgram = accountInfo.owner;

    // Try to detect version by calling lz_compose_types_info
    let version = 1;
    let composeTypesAccounts: LzComposeTypesV2Accounts | undefined;
    try {
        // V2: lz_compose_types_info returns version 2
        composeTypesAccounts = await getLzComposeTypesInfo(
            rpc,
            payer,
            to,
            composerProgram,
            params,
            commitment,
        );
        version = 2;
    } catch (e) {
        // If info call fails or version !== 2, fallback to V1
        version = 1;
    }

    if (version === 2) {
        return buildLzComposeExecutionPlan(
            rpc,
            executorProgram,
            payer,
            to,
            composerProgram,
            params,
            composeTypesAccounts,
            commitment,
        );
    } else {
        // V1: return a single Instruction (legacy behavior)
        const accounts = await getLzComposeAccountsFromTypesV1(
            rpc,
            payer,
            to,
            composerProgram,
            params,
            commitment,
        );
        const data = getLzComposeParamsSerializer().serialize(params);
        return {
            instruction: {
                programId: composerProgram,
                keys: accounts,
                data: Buffer.concat([instructionDiscriminator('lz_compose'), data]),
            },
            contextVersion: 1,
        };
    }
}
