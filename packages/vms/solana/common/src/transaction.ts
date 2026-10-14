import { z } from 'zod';

import {
    hexSchema,
    minedTransactionSchema,
    normalizedHexSchema,
} from '@layerzerolabs/common-chain-model';
import {
    assignedTransactionSchema,
    signedTransactionSchema,
    transactionSchema,
} from '@layerzerolabs/common-chain-model';
import type { PartialBy } from '@layerzerolabs/typescript-utils';

// === Component schemas ===

const _partialWalletTransferInstruction = z.object({
    dstWalletAddress: normalizedHexSchema,
    lamports: z.string(),
    gas: z.string(),
});

export const isPartialWalletTransferInstruction = (
    obj: unknown,
): obj is z.infer<typeof _partialWalletTransferInstruction> => {
    return _partialWalletTransferInstruction.safeParse(obj).success;
};

const _transactionComputedValues = z.object({
    recentBlockHash: z.string(),
    lastValidBlockHeight: z.number(),
    priorityFee: z.number(),
});

const _serializedInstructionSchema = z.object({
    keys: z.array(
        z.object({
            pubkey: z.string(),
            isWritable: z.boolean(),
            isSigner: z.boolean(),
        }),
    ),
    programId: z.string(),
    data: hexSchema,
});

// === Lifecycle schemas ===

export const solanaTransactionSchema = transactionSchema.extend({
    populatedTransaction: z.object({
        instructions: z.array(_serializedInstructionSchema).or(_partialWalletTransferInstruction),
    }),
    additionalSigners: z.array(z.string()).optional(),
    shouldSimulate: z.boolean().optional(),
    replaceAllInjectedPubKeys: z.boolean().optional(),
    meta: z
        .object({
            // accounts necessary to be recorded for deployments
            accounts: z.record(z.string(), normalizedHexSchema).optional(),
            // which key in meta.accounts should be saved as deploymentArtifact.address
            deploymentAddressKey: z.string().optional(),
        })
        .optional(),
});

export const solanaAssignedTransactionSchema = assignedTransactionSchema.extend({
    ...solanaTransactionSchema.shape,
    inflightTransaction: z
        .object({
            computedValues: _transactionComputedValues,
            signatures: z.array(
                z.object({
                    signature: z.string(),
                    publicKey: z.string(),
                }),
            ),
            signedTransaction: z.string(),
        })
        .optional(),
});

export const solanaSignedTransactionSchema = signedTransactionSchema.extend({
    ...solanaAssignedTransactionSchema.shape,
});

export const solanaMinedTransactionSchema = minedTransactionSchema.extend({
    ...solanaSignedTransactionSchema.shape,
});

// === Types ===

export type SolanaTransaction = z.infer<typeof solanaTransactionSchema>;
export type SolanaAssignedTransaction = z.infer<typeof solanaAssignedTransactionSchema>;
export type SolanaSignedTransaction = z.infer<typeof solanaSignedTransactionSchema>;
export type SolanaMinedTransaction = z.infer<typeof solanaMinedTransactionSchema>;

export type SerializedTransactionInstruction = z.infer<typeof _serializedInstructionSchema>;
export type PartialWalletTransferInstruction = z.infer<typeof _partialWalletTransferInstruction>;
export type TransactionComputedValues = z.infer<typeof _transactionComputedValues>;

// === Builder ===

export type BuildSolanaTransactionInput = PartialBy<SolanaTransaction, 'chainName' | 'timestamps'>;

export const buildSolanaTransaction = async (
    chainName: string,
    tx: BuildSolanaTransactionInput,
): Promise<SolanaTransaction> => {
    return {
        ...tx,
        chainName,
        timestamps: {
            created: tx.timestamps?.created ?? Date.now(),
        },
    };
};
