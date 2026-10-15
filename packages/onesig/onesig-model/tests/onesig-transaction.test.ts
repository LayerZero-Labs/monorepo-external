import { describe, expect, it } from 'vitest';

import {
    oneSigBundleTransactionsResponseSchema,
    OneSigTransactionStatus,
} from '../src/model/onesig-bundle/onesig-leaf';

describe('OneSig bundle transactions response', () => {
    it('accepts hashless leaves in every status', () => {
        const transactions = Object.values(OneSigTransactionStatus).map((status, nonce) => ({
            oneSigName: 'test',
            bundleId: 'bundle',
            chainName: 'ethereum',
            nonce,
            status,
            merkleProof: [],
            createdAt: 0,
            updatedAt: 0,
        }));
        expect(
            oneSigBundleTransactionsResponseSchema.parse({
                transactions,
                nextToken: null,
                bundleStatus: 'executed_with_failures',
            }).transactions,
        ).toEqual(transactions);
    });
});
