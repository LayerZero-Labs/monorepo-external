import type { Keypair } from '@stellar/stellar-sdk';
import { TransactionBuilder } from '@stellar/stellar-sdk';

import type { StellarTestEnv } from './env.js';

/**
 * Create a Soroban contract client with DEFAULT_DEPLOYER as signer.
 */
export function createClient<T>(
    env: StellarTestEnv,
    ClientClass: new (options: {
        contractId: string;
        publicKey: string;
        signTransaction: (tx: string) => Promise<{ signedTxXdr: string; signerAddress: string }>;
        rpcUrl: string;
        networkPassphrase: string;
        allowHttp: boolean;
    }) => T,
    contractId: string,
    signer: Keypair = env.DEFAULT_DEPLOYER,
): T {
    return new ClientClass({
        contractId,
        publicKey: signer.publicKey(),
        signTransaction: async (tx: string) => {
            const transaction = TransactionBuilder.fromXDR(tx, env.NETWORK_PASSPHRASE);
            transaction.sign(signer);
            return {
                signedTxXdr: transaction.toXDR(),
                signerAddress: signer.publicKey(),
            };
        },
        rpcUrl: env.RPC_URL,
        networkPassphrase: env.NETWORK_PASSPHRASE,
        allowHttp: true,
    });
}
