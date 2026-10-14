/**
 * Transaction helper bridging UMI and web3.js instruction formats.
 *
 * Solana has two dominant TypeScript SDKs — @metaplex-foundation/umi (used by
 * lz-solana-sdk-v2) and @solana/web3.js (used by SPL token libraries). Test
 * code frequently mixes instructions from both. This wrapper accepts either
 * format, handles compute budget, address lookup tables, and multi-signer
 * coordination in a single call.
 */

import type {
    AddressLookupTableInput,
    Context,
    RpcConfirmTransactionResult,
    RpcSendTransactionOptions,
    Signer,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { TransactionBuilder } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import * as web3 from '@solana/web3.js';

/** Wrap a web3.js TransactionInstruction as a UMI WrappedInstruction. */
const wrapWeb3Instruction = (ix: web3.TransactionInstruction): WrappedInstruction => ({
    instruction: fromWeb3JsInstruction(ix),
    signers: [],
    bytesCreatedOnChain: 0,
});

/** Normalize input to a WrappedInstruction array. */
const normalizeInstructions = (
    input: WrappedInstruction | WrappedInstruction[] | web3.TransactionInstruction[],
): WrappedInstruction[] => {
    if (!Array.isArray(input)) return [input];
    if (input.length === 0) throw new Error('instructions array is empty');

    // Detect web3.js format by checking the first element
    if (input[0] instanceof web3.TransactionInstruction) {
        return (input as web3.TransactionInstruction[]).map(wrapWeb3Instruction);
    }
    return input as WrappedInstruction[];
};

export const sendAndConfirm = async (
    umi: Context,
    rawInstructions: WrappedInstruction | WrappedInstruction[] | web3.TransactionInstruction[],
    signers: Signer | Signer[],
    computeUnitsLimit = 0,
    addressLookupTables?: AddressLookupTableInput[],
    sendOptions?: RpcSendTransactionOptions,
): Promise<{
    signature: string;
    result: RpcConfirmTransactionResult;
}> => {
    let instructions = normalizeInstructions(rawInstructions);

    // Attach additional signers (beyond the fee payer) to each instruction
    const feePayer = Array.isArray(signers) ? signers[0] : signers;
    if (Array.isArray(signers) && signers.length > 1) {
        const ixSigners = signers.slice(1);
        instructions = instructions.map((ix) => ({ ...ix, signers: ixSigners }));
    }

    // Prepend compute budget instruction if requested
    if (computeUnitsLimit > 0) {
        const budgetIx = wrapWeb3Instruction(
            web3.ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitsLimit }),
        );
        instructions = [budgetIx, ...instructions];
    }

    const { signature, result } = await new TransactionBuilder(instructions, {
        feePayer,
        addressLookupTables,
    }).sendAndConfirm(umi, {
        send: {
            skipPreflight: false,
            preflightCommitment: 'processed',
            commitment: 'confirmed',
            ...sendOptions,
        },
    });

    return {
        signature: base58.deserialize(signature)[0],
        result,
    };
};
