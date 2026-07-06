import { arrayify } from '@ethersproject/bytes';
import type { Instruction, PublicKey } from '@metaplex-foundation/umi';
import { createNoopSigner, publicKeyBytes } from '@metaplex-foundation/umi';
import { u64 } from '@metaplex-foundation/umi/serializers';
import { fromWeb3JsPublicKey, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import type { Connection } from '@solana/web3.js';

import { encodeLeaf, makeOneSigTree } from '@layerzerolabs/onesig-core';

import { getOneSigStateAccountDataSerializer } from './generated';
import { getInstructionSerializer, OneSig } from './onesig';
import { simulateLamportAllowances } from './simulate';

export interface BaseLeafData<TargetAddressType = unknown, CallData = unknown> {
    nonce: bigint;
    oneSigId: bigint;
    targetOneSigAddress: TargetAddressType;
    calls: CallData[];
}

export interface GenerateLeafsResult<Leaf extends BaseLeafData = BaseLeafData<any, any>> {
    encodeCalls: (calls: Leaf['calls']) => Buffer;
    encodeAddress: (address: Leaf['targetOneSigAddress']) => Buffer;
    leafs: Leaf[];
}

export * from './configChangeCalls';
export * from './generated';
export * from './onesig';

export type SolanaCallData = Instruction & { value: bigint };
export type SolanaLeafData = BaseLeafData<PublicKey, SolanaCallData>;

export interface BuildOneSigSolanaLeavesArgs {
    connection: Connection;
    dummyFeePayer: PublicKey;
    oneSigState: PublicKey;
    instructions: Instruction[];
}

export interface OneSigSolanaLeafProof {
    call: SolanaCallData;
    proof: string[];
}

export interface BuildOneSigSolanaLeavesResult {
    merkleRoot: Uint8Array;
    leaves: OneSigSolanaLeafProof[];
}

/**
 * Prepares a Call Data specifically for Merkle leaf calculation in the Solana OneSig.
 * This formats the instruction data to be consistent with how the OneSig program will execute it:
 * - Configures the `oneSigSigner` PDA with `isSigner = true` to match
 *   the Rust program's behavior during actual execution.
 * - Sets all other keys' `isSigner` to false.
 *
 * Note: This function is used for generating leaf hashes for the Merkle tree.
 * When actually sending a transaction, account metadata is handled differently.
 */
export function prepareSolanaCallDataForMerkleLeaf(
    oneSig: OneSig,
    call: SolanaCallData,
): SolanaCallData {
    const [oneSigSigner] = oneSig.pda.oneSigSigner();
    return {
        ...call,
        keys: call.keys.map((key) => {
            if (key.pubkey === oneSigSigner) {
                return { ...key, isSigner: true };
            } else {
                return { ...key, isSigner: false };
            }
        }),
    };
}

export function solanaLeafGenerator(
    programId: PublicKey,
    leafs: SolanaLeafData[],
): GenerateLeafsResult<SolanaLeafData> {
    if (leafs.length === 0) {
        throw new Error(`Cannot generate Solana leaf with empty leaves`);
    }
    const oneSigState = leafs[0].targetOneSigAddress;
    const oneSig = new OneSig(programId, createNoopSigner(oneSigState));
    const [oneSigSigner] = oneSig.pda.oneSigSigner();
    return {
        leafs,
        encodeAddress(address: PublicKey) {
            return Buffer.from(publicKeyBytes(address));
        },
        encodeCalls(calls: SolanaLeafData['calls']) {
            if (calls.length !== 1) {
                throw new Error('Solana OneSig only supports one call per leaf');
            }
            return Buffer.concat(
                calls.map((call) => {
                    for (const key of call.keys) {
                        if (key.pubkey === oneSigSigner) {
                            if (!key.isSigner) {
                                throw new Error('oneSigSigner must be signer');
                            }
                        } else if (key.isSigner) {
                            throw new Error('Only oneSigSigner can be a signer');
                        }
                    }
                    const ix = {
                        programId: call.programId,
                        keys: call.keys.slice(1),
                        data: call.data,
                    };
                    return Buffer.concat([
                        getInstructionSerializer().serialize(ix),
                        u64().serialize(call.value),
                    ]);
                }),
            );
        },
    };
}

/**
 * Simulates per-instruction lamport allowances, then builds executable OneSig leaves.
 */
export async function buildOneSigSolanaLeaves(
    args: BuildOneSigSolanaLeavesArgs,
): Promise<BuildOneSigSolanaLeavesResult> {
    if (args.instructions.length === 0) {
        throw new Error('Cannot build a OneSig Solana Merkle tree without instructions');
    }

    const accountInfo = await args.connection.getAccountInfo(toWeb3JsPublicKey(args.oneSigState));
    if (!accountInfo) {
        throw new Error(`OneSig state account not found: ${args.oneSigState}`);
    }

    const [state] = getOneSigStateAccountDataSerializer().deserialize(accountInfo.data);
    const programId = fromWeb3JsPublicKey(accountInfo.owner);
    const oneSig = new OneSig(programId, createNoopSigner(args.oneSigState));
    const [oneSigSigner] = oneSig.pda.oneSigSigner();

    const lamportsAllowance = await simulateLamportAllowances({
        connection: args.connection,
        oneSigSigner,
        instructions: args.instructions,
        dummyFeePayer: args.dummyFeePayer,
    });

    const calls = args.instructions.map((instruction, index) =>
        toOneSigSolanaCall(instruction, lamportsAllowance[index] ?? 0n),
    );
    const leafs: SolanaLeafData[] = calls.map((call, index) => ({
        nonce: state.nonce + BigInt(index),
        oneSigId: state.oneSigId,
        targetOneSigAddress: args.oneSigState,
        calls: [prepareSolanaCallDataForMerkleLeaf(oneSig, call)],
    }));
    const generator = solanaLeafGenerator(programId, leafs);
    const tree = makeOneSigTree([generator]);

    return {
        merkleRoot: arrayify(tree.getRoot()),
        leaves: calls.map((call, index) => {
            const leafHash = encodeLeaf(generator, index);
            return {
                call,
                proof: tree.getHexProof(leafHash),
            };
        }),
    };
}

/**
 * Converts a normal UMI target instruction into the call shape expected by the
 * OneSig Solana executor.
 */
function toOneSigSolanaCall(
    instruction: Instruction,
    lamportsAllowance = BigInt(0),
): SolanaCallData {
    return {
        ...instruction,
        value: lamportsAllowance,
        keys: [
            {
                pubkey: instruction.programId,
                isSigner: false,
                isWritable: false,
            },
            ...instruction.keys,
        ].map((key) => ({ ...key, isSigner: false })),
    };
}
