import type { contract, Keypair } from '@stellar/stellar-sdk';

import {
    Secp256k1KeyPair,
    signDvnAuthEntries as signDvnAuthEntriesEnv,
} from '@layerzerolabs/test-utils-stellar';

export async function signDvnAuthEntries<T>(
    dvnAddress: string,
    vid: number,
    adminKeypair: Keypair,
    multisigSigners: Secp256k1KeyPair[],
    assembledTx: contract.AssembledTransaction<T>,
    networkPassphrase: string,
): Promise<void> {
    return signDvnAuthEntriesEnv(
        dvnAddress,
        vid,
        adminKeypair,
        multisigSigners,
        assembledTx,
        networkPassphrase,
    );
}
