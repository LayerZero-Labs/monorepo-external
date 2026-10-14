import type { TransactionInstruction } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

/**
 * Injected payers are used to add to accounts for transaction instructions
 * but are meant to be replaced by the actual fee payer when submitting the tx.
 * Addresses should be in base58 and funded with SOL for tx simulation.
 */
const injectedPayerPerEnv: { [environment: string]: string } = {
    localnet: '9uLJKWXinBXUrtWnWxs4VsGmumNdEkyg8BY3TD9Bnrg7', // "m/44'/501'/0'/2'"
    sandbox: '9uLJKWXinBXUrtWnWxs4VsGmumNdEkyg8BY3TD9Bnrg7',
    testnet: 'GhQnhkaFqi234nwqFJYVeSftY25BSSGmk2wF4DUBzPbq', // funded
    mainnet: 'GhQnhkaFqi234nwqFJYVeSftY25BSSGmk2wF4DUBzPbq', // requires funding
};

/**
 * Inject a temporary address as the payer for simulated transactions
 * @param {string} environment environment name
 */
export function getSolanaInjectedPayerAddress(environment: string): string {
    const injectedPayer = injectedPayerPerEnv[environment];
    if (!injectedPayer) {
        throw new Error(`Solana: No injected payer for environment ${environment}`);
    }
    return injectedPayer;
}

export function getSolanaInjectedPayerPublicKey(environment: string): PublicKey {
    return new PublicKey(getSolanaInjectedPayerAddress(environment));
}

/**
 * Replace the fee payer in the transaction instructions
 * @param environment environment
 * @param publicKey public key of the new fee payer
 * @param instructions transaction instructions
 * @param replaceAllInjectedPubKeys
 *  default false: only replace the injected payer where it is a signer (avoids touching it in other instructions)
 *  true: replace the injected payer in all instructions
 * @returns transaction instructions
 */
export const replaceFeePayerInTransactionInstructions = (
    environment: string,
    publicKey: PublicKey,
    instructions: TransactionInstruction[],
    replaceAllInjectedPubKeys: boolean = false,
) => {
    const injectedPayer = getSolanaInjectedPayerPublicKey(environment);
    for (const instruction of instructions) {
        for (const key of instruction.keys) {
            //check isSigner so as to avoid overwriting non-injected matching keys
            if (
                key.pubkey.equals(injectedPayer) &&
                (key.isSigner === true || replaceAllInjectedPubKeys)
            ) {
                key.pubkey = publicKey;
            }
        }
    }

    return instructions;
};
