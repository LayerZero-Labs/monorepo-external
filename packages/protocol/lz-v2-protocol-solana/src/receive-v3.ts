import type {
    Commitment,
    Instruction,
    PublicKey,
    RpcInterface,
    Signer,
} from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';
import invariant from 'tiny-invariant';

import { arrayify } from '@layerzerolabs/lz-utilities';
import type { Packet } from '@layerzerolabs/lz-v2-utilities';
import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities';

import { buildLzComposeExecutionPlanV3 } from './compose-types-v3';
import type { Executor } from './executor';
import type { ComposeSentEvent } from './generated/endpoint/events';
import { EXECUTOR_PROGRAM_ID } from './generated/executor/programs';
import { buildLzReceiveExecutionPlanV3 } from './receive-types-v3';
import type { LzComposeParams, LzReceiveParams } from './types';

/**
 * Receive a LayerZero message through V3 account-backed discovery. There is no fallback: an OApp
 * that does not answer V3 fails here instead of being planned with a legacy planner.
 */
export async function lzReceiveV3(
    rpc: RpcInterface,
    payer: PublicKey,
    packet: Pick<Packet, 'message' | 'sender' | 'srcEid' | 'guid' | 'receiver' | 'nonce'>,
    callerParams: Uint8Array = Uint8Array.from([0, 0]),
    executorProgram: PublicKey = EXECUTOR_PROGRAM_ID,
    commitment: Commitment = 'confirmed',
): ReturnType<typeof buildLzReceiveExecutionPlanV3> {
    const { message: message_, sender: sender_, srcEid, guid, receiver: receiver_, nonce } = packet;
    const sender = arrayify(sender_);
    const receiverBytes = addressToBytes32(receiver_);
    const message = arrayify(message_);
    const params: LzReceiveParams = {
        srcEid: srcEid,
        sender,
        guid: arrayify(guid),
        message,
        callerParams,
        nonce: BigInt(nonce),
    };
    const receiverPubkey = publicKey(receiverBytes);
    const receiverInfo = await rpc.getAccount(receiverPubkey, { commitment });
    invariant(receiverInfo.exists, `Receiver account not found: ${receiverPubkey}`);
    const receiverProgram = publicKey(receiverInfo.owner);

    return buildLzReceiveExecutionPlanV3(
        rpc,
        executorProgram,
        payer,
        receiverPubkey,
        receiverProgram,
        params,
        undefined,
        commitment,
    );
}

/** Compose a LayerZero message through V3 account-backed discovery, with no fallback. */
export async function lzComposeV3(
    rpc: RpcInterface,
    payer: PublicKey,
    event: ComposeSentEvent,
    extraData: Uint8Array = Uint8Array.from([0, 0]),
    executorProgram: PublicKey = EXECUTOR_PROGRAM_ID,
    commitment: Commitment = 'confirmed',
): ReturnType<typeof buildLzComposeExecutionPlanV3> {
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

    return buildLzComposeExecutionPlanV3(
        rpc,
        executorProgram,
        payer,
        to,
        composerProgram,
        params,
        undefined,
        commitment,
    );
}

/** `Executor.execute` for V3 OApps: the planned instructions between pre- and post-execute. */
export async function executeV3(
    executorProgram: Executor,
    rpc: RpcInterface,
    executor: Signer,
    param: {
        packet: Packet;
        extraData: Uint8Array;
        value?: bigint;
    },
    commitment: Commitment = 'confirmed',
): Promise<{
    signers: Signer[];
    instructions: Instruction[];
}> {
    const { packet, extraData, value = 0n } = param;
    const lzReceiveResult = await lzReceiveV3(
        rpc,
        executor.publicKey,
        packet,
        extraData,
        executorProgram.programId,
        commitment,
    );
    const { contextVersion } = lzReceiveResult;
    return {
        signers: [...lzReceiveResult.signers],
        instructions: [
            executorProgram.preExecute(executor, contextVersion, value).instruction,
            ...lzReceiveResult.instructions,
            executorProgram.postExecute(executor, contextVersion).instruction,
        ],
    };
}

/** `Executor.compose` for V3 composers: the planned instructions between pre- and post-execute. */
export async function composeV3(
    executorProgram: Executor,
    rpc: RpcInterface,
    executor: Signer,
    param: {
        event: ComposeSentEvent;
        extraData: Uint8Array;
        value?: bigint;
    },
    commitment: Commitment = 'confirmed',
): Promise<{
    signers: Signer[];
    instructions: Instruction[];
}> {
    const { event, extraData, value = 0n } = param;
    const lzComposeResult = await lzComposeV3(
        rpc,
        executor.publicKey,
        event,
        extraData,
        executorProgram.programId,
        commitment,
    );
    const { contextVersion } = lzComposeResult;
    return {
        signers: [...lzComposeResult.signers],
        instructions: [
            executorProgram.preExecute(executor, contextVersion, value).instruction,
            ...lzComposeResult.instructions,
            executorProgram.postExecute(executor, contextVersion).instruction,
        ],
    };
}
