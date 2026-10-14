import { PublicKey, type TransactionInstruction } from '@solana/web3.js';

import type { HexString } from '@layerzerolabs/common-chain-model';
import { bytesToHexPrefixed, hexToBytes } from '@layerzerolabs/common-encoding-utils';

import type { SerializedTransactionInstruction } from './transaction';

/** Decode instruction `data` (`0x`-hex) or raw bytes to a Buffer. Instruction data is always
 *  whole bytes; hexToBytes rejects malformed or odd-length input rather than truncating. */
export const instructionDataToBuffer = (data: HexString | Uint8Array): Buffer =>
    typeof data === 'string' ? Buffer.from(hexToBytes(data)) : Buffer.from(data);

/** Normalize instruction `data` to a `0x`-prefixed hex string. */
export const instructionDataToHex = (data: HexString | Uint8Array): HexString =>
    typeof data === 'string' ? data : bytesToHexPrefixed(data);

export const serializeTransactionInstruction = (
    instruction: TransactionInstruction,
): SerializedTransactionInstruction => {
    return {
        keys: instruction.keys.map((key) => ({
            pubkey: key.pubkey.toString(),
            isWritable: key.isWritable,
            isSigner: key.isSigner,
        })),
        programId: instruction.programId.toString(),
        data: instructionDataToHex(instruction.data),
    };
};

export const deserializeTransactionInstructions = (
    instructions: SerializedTransactionInstruction[],
): TransactionInstruction[] => {
    return instructions.map((instruction) => ({
        keys: instruction.keys.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isWritable: key.isWritable,
            isSigner: key.isSigner,
        })),
        programId: new PublicKey(instruction.programId),
        data: instructionDataToBuffer(instruction.data),
    }));
};
