import type {
    AddressLookupTableAccount,
    ParsedTransaction,
    PartiallyDecodedInstruction,
    TransactionInstruction,
} from '@solana/web3.js';
import {
    ComputeBudgetInstruction,
    ComputeBudgetProgram,
    Keypair,
    PublicKey,
    Transaction,
} from '@solana/web3.js';
import { getSimulationComputeUnits } from '@solana-developers/helpers';
import { backOff } from 'exponential-backoff';

import { base58ToBytes, bytesToBase58 } from '@layerzerolabs/common-encoding-utils';

import type { SolanaProvider } from './provider';
import { deserializeTransactionInstructions } from './serialization';
import type { SerializedTransactionInstruction, TransactionComputedValues } from './transaction';

export { deserializeTransactionInstructions as deserializeInstructions } from './serialization';

export const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId.toBase58();

/** Solana ComputeBudget program instruction discriminators (first data byte). */
export const ComputeBudgetDiscriminators = {
    RequestUnits: 0,
    RequestHeapFrame: 1,
    SetComputeUnitLimit: 2,
    SetComputeUnitPrice: 3,
    SetLoadedAccountsDataSizeLimit: 4,
} as const;

/** Accepts both the web3.js instruction and the JSON snapshot shape, which carries a string id. */
export const isComputeBudgetInstruction = (instruction: {
    programId: PublicKey | string;
}): boolean => {
    const { programId } = instruction;
    const id = typeof programId === 'string' ? programId : programId.toBase58();
    return id === COMPUTE_BUDGET_PROGRAM_ID;
};

/**
 * MicroLamports from SetComputeUnitPrice only. Other compute-budget instructions
 * (limits, heap frame, loaded-accounts size, deprecated RequestUnits) return undefined.
 */
export const sampleComputeBudgetFeeValue = (
    instruction: TransactionInstruction,
): bigint | undefined => {
    // Only SetComputeUnitPrice is a priority-fee magnitude; skip every other discriminator
    // before decodeSetComputeUnitPrice so non-price layouts are never decoded.
    if (instruction.data[0] !== ComputeBudgetDiscriminators.SetComputeUnitPrice) {
        return undefined;
    }
    // SetComputeUnitPrice layout: 1-byte discriminator + little-endian u64.
    if (instruction.data.length < 9) {
        return undefined;
    }
    return BigInt(ComputeBudgetInstruction.decodeSetComputeUnitPrice(instruction).microLamports);
};

export const getSimulatedBudgetInstruction = async (
    provider: SolanaProvider,
    instructions: TransactionInstruction[],
    payer: PublicKey,
    lookupTables: AddressLookupTableAccount[] = [],
) => {
    const units = await getSimulationComputeUnits(
        provider.connection,
        instructions,
        payer,
        lookupTables,
    );

    if (!units) {
        return null;
    }

    return ComputeBudgetProgram.setComputeUnitLimit({
        units: units < 1000 ? 1000 : Math.ceil(units * 1.5),
    });
};

export const encodeSolanaPublicKey = (data: Uint8Array): PublicKey => {
    return new PublicKey(bytesToBase58(data));
};

/**
 * Parses a string into a Solana PublicKey.
 *
 * @param address - The address string to parse
 * @returns A Solana PublicKey instance
 */
export const parsePublicKey = (address: string): PublicKey => {
    return new PublicKey(address);
};

export const modifyInstructionsWithComputeBudgetInstructions = async (
    provider: SolanaProvider,
    instructions: TransactionInstruction[],
    payer: PublicKey,
    shouldSimulate: boolean,
): Promise<TransactionInstruction[]> => {
    if (!shouldSimulate) {
        return instructions;
    }

    const nonBudgetInstructions = instructions.filter(
        (instruction) => !isComputeBudgetInstruction(instruction),
    );

    const computeBudgetInstruction = await getSimulatedBudgetInstruction(
        provider,
        nonBudgetInstructions,
        payer,
    );

    if (!computeBudgetInstruction) {
        return instructions;
    }

    return [computeBudgetInstruction, ...nonBudgetInstructions];
};

// TODO: txGasPricePremium should come from a config.
export const getComputeUnitPrice = async (
    provider: SolanaProvider,
    txGasPricePremiumPercent: number = 20,
): Promise<number> => {
    const premium = txGasPricePremiumPercent + 100;

    const currentSlot = await backOff(async () => await provider.connection.getSlot('confirmed'), {
        startingDelay: 1000,
        numOfAttempts: 5,
        jitter: 'full',
    });

    const block = await provider.connection.getParsedBlock(currentSlot, {
        transactionDetails: 'full',
        maxSupportedTransactionVersion: 1,
    });

    const feeSamples = block.transactions.flatMap((tx) => {
        const parsedTx = tx.transaction as unknown as ParsedTransaction;
        return parsedTx.message.instructions
            .filter((instruction) => isComputeBudgetInstruction(instruction))
            .flatMap((partialInstruction) => {
                const instruction = {
                    programId: partialInstruction.programId,
                    keys: (partialInstruction as PartiallyDecodedInstruction).accounts.map(
                        (pubkey) => ({
                            pubkey,
                            isWritable: false,
                            isSigner: false,
                        }),
                    ),
                    data: base58ToBytes((partialInstruction as PartiallyDecodedInstruction).data),
                } as TransactionInstruction;

                const sample = sampleComputeBudgetFeeValue(instruction);
                return sample === undefined ? [] : [sample];
            });
    });

    if (feeSamples.length === 0) {
        return 1_000_000; // Default to 1 lamport if no fee samples found (1e6 microLamports)
    }

    const average =
        feeSamples.reduce((acc, sample) => acc + sample, 0n) / BigInt(feeSamples.length);
    return Math.max(Number((average * BigInt(premium) + 99n) / 100n), 1_000_000); // Ensure at least 1 lamport (1e6 microLamports)
};

export const computeTransactionValues = async (
    provider: SolanaProvider,
): Promise<TransactionComputedValues> => {
    const [blockHash, fee] = await Promise.all([
        provider.connection.getLatestBlockhashAndContext('finalized'),
        getComputeUnitPrice(provider),
    ]);

    return {
        recentBlockHash: blockHash.value.blockhash,
        lastValidBlockHeight: blockHash.value.lastValidBlockHeight,
        priorityFee: fee,
    };
};

export const getTransactionSize = (
    _instructions: (SerializedTransactionInstruction | TransactionInstruction)[],
) => {
    const stubSigner = Keypair.generate();
    const parsedInstructions = JSON.parse(
        JSON.stringify(_instructions),
    ) as SerializedTransactionInstruction[];

    const instructions = deserializeTransactionInstructions(parsedInstructions);

    const tx = new Transaction({
        blockhash: new Array(32).fill(1).join(''),
        lastValidBlockHeight: 0,
    });
    tx.add(...instructions);
    tx.sign(stubSigner);

    const numberOfSignatures = tx.signatures.length;
    const messageLength =
        tx.serializeMessage().length + numberOfSignatures + numberOfSignatures * 64;

    return messageLength;
};
