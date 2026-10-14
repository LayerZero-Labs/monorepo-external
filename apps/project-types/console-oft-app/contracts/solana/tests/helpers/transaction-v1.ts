/**
 * The validator suite's only transaction transport: Solana Transaction V1 through the protocol
 * package's `/v3` transport, with no address lookup tables. Umi's TransactionBuilder and the shared
 * `sendAndConfirm` serialize legacy/V0 messages and are not used.
 *
 * Resource budgets are V1 message config, stated on every transaction (`TEST_BUDGETS` unless a
 * caller passes its own); `compileTransactionV1` rejects ComputeBudget instructions.
 */

import {
    type Instruction,
    type PublicKey,
    type Signer,
    TransactionBuilder,
    type WrappedInstruction,
} from '@metaplex-foundation/umi';
import type { Serializer } from '@metaplex-foundation/umi/serializers';
import { fromWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import { type Connection, TransactionInstruction } from '@solana/web3.js';

import {
    sendTransactionV1,
    simulateTransactionV1,
    type TransactionV1Budgets,
} from '@layerzerolabs/lz-v2-protocol-solana/v3';

export {
    decodeEvents,
    fetchTransactionV1 as fetchV1Transaction,
    type LandedTransaction,
    TransactionV1Error,
} from '@layerzerolabs/lz-v2-protocol-solana/v3';

/** The budgets these validator tests run under; generous, since they only need to fit. */
export const TEST_BUDGETS: TransactionV1Budgets = {
    computeUnitLimit: 1_400_000,
    loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
    heapSize: 256 * 1024,
};

/** Anything the suite submits: generated-client builders, Umi instructions, or SPL (web3) ones. */
export type TransactionInput =
    | Instruction
    | WrappedInstruction
    | TransactionBuilder
    | TransactionInstruction;

function flatten(inputs: readonly TransactionInput[]): {
    instructions: Instruction[];
    signers: Signer[];
} {
    const wrapped = inputs.flatMap((input): WrappedInstruction[] => {
        if (input instanceof TransactionBuilder) return input.items;
        if (input instanceof TransactionInstruction)
            return [
                { instruction: fromWeb3JsInstruction(input), signers: [], bytesCreatedOnChain: 0 },
            ];
        if ('instruction' in input) return [input];
        return [{ instruction: input, signers: [], bytesCreatedOnChain: 0 }];
    });
    return {
        instructions: wrapped.map((item) => item.instruction),
        signers: wrapped.flatMap((item) => item.signers),
    };
}

/** Submit and confirm one V1 transaction; a builder's attached signers sign alongside `signers`. */
export async function sendV1(
    connection: Connection,
    payer: Signer,
    inputs: readonly TransactionInput[],
    {
        signers = [],
        budgets = TEST_BUDGETS,
    }: { signers?: readonly Signer[]; budgets?: TransactionV1Budgets } = {},
): Promise<string> {
    const flat = flatten(inputs);
    return sendTransactionV1(connection, payer, flat.instructions, {
        signers: [...signers, ...flat.signers],
        budgets,
    });
}

/** Simulate unsigned V1 instructions and decode `programId`'s return data. */
export function simulateV1<From, To extends From = From>(
    connection: Connection,
    payer: PublicKey,
    instructions: readonly Instruction[],
    programId: PublicKey,
    serializer: Serializer<From, To>,
    budgets: TransactionV1Budgets = TEST_BUDGETS,
): Promise<To> {
    return simulateTransactionV1(connection, payer, instructions, programId, serializer, budgets);
}
