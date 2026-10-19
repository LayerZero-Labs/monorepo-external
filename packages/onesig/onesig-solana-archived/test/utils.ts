import {
    AddressLookupTableInput,
    RpcConfirmTransactionResult,
    Signer,
    TransactionBuilder,
    Umi,
    WrappedInstruction,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
// FIXME: we should not need this here, this should use metaplex packages
import * as web3 from '@solana/web3.js';
import { expect } from 'vitest';

/**
 * Pauses execution for the specified number of milliseconds
 * @param ms - Number of milliseconds to sleep
 * @returns Promise that resolves after the specified duration
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Result of a transaction send operation
 */
export interface TransactionSendResult {
    /** The base58-encoded transaction signature */
    signature: string;
    /** The confirmation result */
    result: RpcConfirmTransactionResult;
    /** The size of the transaction in bytes */
    txSize: number;
}

function transactionBuilder(
    instructions: WrappedInstruction | WrappedInstruction[],
    signers: Signer | Signer[],
    computeUnitsLimit = 0,
    addressLookupTables?: AddressLookupTableInput,
): TransactionBuilder {
    // Convert single instruction to array for consistent handling
    const ixArray = Array.isArray(instructions) ? instructions : [instructions];

    // Extract fee payer (first signer)
    const feePayer = Array.isArray(signers) ? signers[0] : signers;

    // If multiple signers provided, set additional signers for each instruction
    if (Array.isArray(signers) && signers.length > 1) {
        const additionalSigners = signers.slice(1);
        ixArray.forEach((ix) => {
            ix.signers = additionalSigners;
        });
    }

    // Build transaction with instructions
    let allInstructions = [...ixArray];

    // Add compute budget instruction if limit is specified
    if (computeUnitsLimit > 0) {
        const computeUnitsBudgetIX = web3.ComputeBudgetProgram.setComputeUnitLimit({
            units: computeUnitsLimit,
        });
        allInstructions = [
            {
                instruction: fromWeb3JsInstruction(computeUnitsBudgetIX),
                signers: [],
                bytesCreatedOnChain: 0,
            },
            ...allInstructions,
        ];
    }

    // Build, send and confirm transactions
    return new TransactionBuilder(allInstructions, {
        feePayer,
        addressLookupTables: addressLookupTables ? [addressLookupTables] : [],
    });
}

/**
 * Sends and confirms a transaction containing one or more wrapped instructions.
 *
 * This utility function handles the common pattern of building, sending, and confirming
 * transactions in Solana tests. It supports multiple instructions, signers, and
 * compute budget configuration.
 *
 * @param umi - The Umi instance to use for sending the transaction
 * @param instructions - A single wrapped instruction or an array of wrapped instructions
 * @param signers - A single signer or an array of signers (first signer is the fee payer)
 * @param computeUnitsLimit - Optional compute units limit (default: 0 - no limit)
 * @returns Promise resolving to transaction signature and confirmation result
 */
export async function sendAndConfirm(
    umi: Umi,
    instructions: WrappedInstruction | WrappedInstruction[],
    signers: Signer | Signer[],
    computeUnitsLimit = 0,
    addressLookupTables?: AddressLookupTableInput,
): Promise<TransactionSendResult> {
    const builder = transactionBuilder(
        instructions,
        signers,
        computeUnitsLimit,
        addressLookupTables,
    );
    const result = await builder.sendAndConfirm(umi, {
        send: { preflightCommitment: 'confirmed', commitment: 'confirmed' },
    });
    return {
        signature: base58.deserialize(result.signature)[0],
        result: result.result,
        txSize: builder.getTransactionSize(umi),
    };
}

export async function getTransactionSize(
    umi: Umi,
    instructions: WrappedInstruction | WrappedInstruction[],
    signers: Signer | Signer[],
    computeUnitsLimit = 0,
    addressLookupTables?: AddressLookupTableInput,
): Promise<number> {
    const builder = transactionBuilder(
        instructions,
        signers,
        computeUnitsLimit,
        addressLookupTables,
    );
    return builder.getTransactionSize(umi);
}

/**
 * Error specification for expected errors in tests
 */
export type ExpectedError = { code: number; name: string } | string;

/**
 * Tests that a promise is rejected with an expected error
 *
 * @param fn - The promise or async function to test
 * @param error - The expected error (either a string or an object with code and name)
 * @param printLogs - Whether to print detailed error logs (default: false)
 */
export async function shouldBeRejected(
    fn: Promise<any>,
    error: ExpectedError,
    printLogs = false,
): Promise<void> {
    try {
        await fn;
        throw new Error('Expected function to be rejected, but it succeeded');
    } catch (e) {
        const errorMsgMatch =
            typeof error === 'string'
                ? error
                : `Error Code: ${error.name}. Error Number: ${error.code.toString(10)}`;

        if (e instanceof web3.SendTransactionError) {
            if (printLogs) {
                console.error('SendTransactionError:', e.transactionError);
            }
            expect(JSON.stringify(e.transactionError.logs).includes(errorMsgMatch)).toEqual(true);
        } else if (e instanceof Error) {
            if (printLogs) {
                console.error('Error:', e.message);
            }
            expect(e.message.includes(errorMsgMatch)).toEqual(true);
        } else {
            if (printLogs) {
                console.error('Non-standard error:', e);
            }
            expect(JSON.stringify(e).includes(errorMsgMatch)).toEqual(true);
        }
    }
}
