import { z } from 'zod';

import {
    assignedTransactionSchema,
    buildTransactionWithResultSchema,
    minedTransactionSchema,
    signedTransactionSchema,
    transactionSchema,
} from '@layerzerolabs/common-chain-model';
import type { PartialBy } from '@layerzerolabs/typescript-utils';

import { cantonRefreshPlanSchema } from './refresh/plan';
import { cantonCommandExpirySchema } from './types';

// === Component schemas ===

export const cantonCommandSchema = z.union([
    z.object({
        createCommand: z.object({
            templateId: z.string(),
            createArguments: z.any(),
        }),
    }),
    z.object({
        exerciseCommand: z.object({
            templateId: z.string(),
            contractId: z.string(),
            choice: z.string(),
            choiceArgument: z.any(),
        }),
    }),
    z.object({
        createAndExerciseCommand: z.object({
            templateId: z.string(),
            createArguments: z.any(),
            choice: z.string(),
            choiceArgument: z.any(),
        }),
    }),
    z.object({
        exerciseByKeyCommand: z.object({
            templateId: z.string(),
            contractKey: z.any(),
            choice: z.string(),
            choiceArgument: z.any(),
        }),
    }),
]);

export const cantonDisclosedContractSchema = z.object({
    templateId: z.string().optional(),
    contractId: z.string(),
    createdEventBlob: z.string(),
    synchronizerId: z.string(),
});

// === Lifecycle schemas ===

/**
 * Canton transaction schema for Daml Ledger API commands.
 */
export const cantonTransactionSchema = transactionSchema.extend({
    populatedTransaction: z.object({
        unresolvedCommands: z.array(cantonCommandSchema),
        unresolvedDisclosedContracts: z.array(cantonDisclosedContractSchema),

        /** Parties submitting the command (actAs) */
        actAs: z.array(z.string()),
        /** Maps each actAs party → the senderEntityName(s) controlling its signing
         *  key(s), always as an array. `.optional()` only so deferred-sender create-time
         *  payloads parse. At sign time: multi-party transactions must map every actAs
         *  party or signing throws; single-party transactions may omit the map and sign()
         *  falls back to the queue's senderEntityName. Multiple entries = a multisig party
         *  (decentralized namespace) whose keys must all sign. */
        partyToSenderEntity: z.record(z.string(), z.array(z.string())).optional(),
        /** Deployment spec set at prepare time; the deployment activity resolves the live address ref from this + the createCommand. */
        deploymentSpec: z
            .object({
                packageName: z.string(),
                ownerField: z.string(),
                identityKeys: z.array(z.string()),
            })
            .optional(),
        /** Build-time replacements for volatile command inputs and disclosures. */
        refreshPlan: cantonRefreshPlanSchema.optional(),
    }),
});

export const cantonTransactionWithResultSchema =
    buildTransactionWithResultSchema(cantonTransactionSchema);

const cantonInflightTransactionBaseSchema = z.object({
    /** The prepared transaction blob */
    preparedTransaction: z.string(),
    /** Hash of the prepared transaction (what was signed) */
    preparedTransactionHash: z.string(),
    /** Command ID for tracking */
    commandId: z.string(),
    // Ledger offset at which the submission landed — used as `beginExclusive`
    // for waitForCommand to avoid polling from the start of the ledger.
    //  Optional: only present after send(); absent for old/retry scenarios.
    completionOffset: z.number().optional(),
});

const cantonInflightTransactionSchema = z.union([
    cantonInflightTransactionBaseSchema.extend({
        hashingSchemeVersion: z.literal('HASHING_SCHEME_VERSION_V3'),
        expiry: cantonCommandExpirySchema,
        expired: z.boolean().optional(),
    }),
    cantonInflightTransactionBaseSchema.extend({
        /** Hashing scheme version used */
        hashingSchemeVersion: z.enum([
            'HASHING_SCHEME_VERSION_UNSPECIFIED',
            'HASHING_SCHEME_VERSION_V2',
        ]),
    }),
]);

/**
 * Assigned transaction includes the inflight transaction data.
 */
export const cantonAssignedTransactionSchema = assignedTransactionSchema.extend({
    ...cantonTransactionSchema.shape,
    inflightTransaction: cantonInflightTransactionSchema.optional(),
});

/**
 * Signed transaction includes the DER-encoded ECDSA signature.
 */
export const cantonSignedTransactionSchema = signedTransactionSchema.extend({
    ...cantonAssignedTransactionSchema.shape,
    // Resolved commands and contracts
    commands: z.array(cantonCommandSchema),
    disclosedContracts: z.array(cantonDisclosedContractSchema),
    signedTransaction: z.object({
        /** Per-party signatures in the format expected by Canton's submitSigned */
        signatures: z.array(
            z.object({
                party: z.string(),
                signatures: z.array(
                    z.object({
                        format: z.string(),
                        signature: z.string(),
                        signedBy: z.string(),
                        signingAlgorithmSpec: z.string(),
                    }),
                ),
            }),
        ),
    }),
});

/**
 * Mined transaction with confirmation result.
 */
export const cantonMinedTransactionSchema = minedTransactionSchema.extend({
    ...cantonSignedTransactionSchema.shape,
    inflightTransaction: cantonInflightTransactionSchema,
});

export type CantonTx = z.infer<typeof cantonTransactionSchema>;
export type CantonPopulatedTransaction = CantonTx['populatedTransaction'];
export type CantonCommand = z.infer<typeof cantonCommandSchema>;
export type CantonUnresolvedCommand = CantonCommand;
export type CantonDisclosedContract = z.infer<typeof cantonDisclosedContractSchema>;
export type CantonAssignedTx = z.infer<typeof cantonAssignedTransactionSchema>;
export type CantonSignedTx = z.infer<typeof cantonSignedTransactionSchema>;
export type CantonMinedTx = z.infer<typeof cantonMinedTransactionSchema>;

// === Builder ===

export type BuildCantonTransactionInput = PartialBy<CantonTx, 'chainName' | 'timestamps'>;

export const buildCantonTransaction = async (
    chainName: string,
    tx: BuildCantonTransactionInput,
): Promise<CantonTx> => {
    return {
        ...tx,
        chainName,
        timestamps: {
            created: tx.timestamps?.created ?? Date.now(),
        },
    };
};
