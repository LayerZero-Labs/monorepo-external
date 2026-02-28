import type { Instruction, PublicKey } from '@metaplex-foundation/umi';
import { createNoopSigner, publicKeyBytes } from '@metaplex-foundation/umi';
import { u64 } from '@metaplex-foundation/umi/serializers';

import { getInstructionSerializer, OneSig } from './onesig';

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

export * from './generated';
export * from './onesig';

export type SolanaCallData = Instruction & { value: bigint };
export type SolanaLeafData = BaseLeafData<PublicKey, SolanaCallData>;

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
        throw new Error('Cannot generate Solana leaf with empty leafs');
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
