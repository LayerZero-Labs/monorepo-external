import type { TransactionWithResult } from '@layerzerolabs/common-chain-model';

import type { SolanaProvider } from './provider';

export const transactionSucceeded = async (
    providerAdapter: SolanaProvider,
    txWithResult?: TransactionWithResult,
) => {
    // Check if the transaction succeeded by looking at the transaction result
    if (!txWithResult || txWithResult.result.type !== 'success') {
        return false;
    }

    const txHash = txWithResult.result.minedTxHash;
    try {
        // Get the transaction details from Solana
        const txResult = await providerAdapter.connection.getParsedTransaction(txHash);
        // If transaction exists and has no error, it succeeded
        const result = txResult !== null && txResult.meta?.err === null;
        return result;
    } catch {
        return false;
    }
};
