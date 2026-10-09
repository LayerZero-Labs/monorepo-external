import { z } from 'zod';

import {
    multiSigExecutedProposedTransactionSchema,
    multiSigSignedTransactionToProposeSchema,
    multiSigTransactionToProposeSchema,
} from '@layerzerolabs/common-chain-model';

export const suiMoveMultiSigTransactionToProposeSchema = multiSigTransactionToProposeSchema.extend({
    populatedTransaction: z.object({
        transaction: z.string(),
    }),
});

export const suiMoveMultiSigSignedTransactionToProposeSchema =
    multiSigSignedTransactionToProposeSchema.extend({
        ...suiMoveMultiSigTransactionToProposeSchema.shape,
        signedTransaction: z.object({
            signerPublicKey: z.string(),
            txBytes: z.string(),
            signature: z.string(),
            txHash: z.string(),
        }),
    });

export const suiMoveMultiSigExecutedProposedTransactionSchema =
    multiSigExecutedProposedTransactionSchema.extend({
        ...suiMoveMultiSigSignedTransactionToProposeSchema.shape,
    });

export type SuiMoveMultiSigTransactionToPropose = z.infer<
    typeof suiMoveMultiSigTransactionToProposeSchema
>;
export type SuiMoveMultiSigSignedTransactionToPropose = z.infer<
    typeof suiMoveMultiSigSignedTransactionToProposeSchema
>;
export type SuiMoveMultiSigExecutedProposedTransaction = z.infer<
    typeof suiMoveMultiSigExecutedProposedTransactionSchema
>;
