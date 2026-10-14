import {
    createInitializeMultisigInstruction,
    MULTISIG_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Keypair, SystemProgram } from '@solana/web3.js';

export async function createMultisigIx(
    connection: Connection,
    payerPk: PublicKey,
    signers: PublicKey[],
    m: number,
    programId = TOKEN_PROGRAM_ID,
): Promise<{ instructions: TransactionInstruction[]; multisigKp: Keypair }> {
    // a one time use keypair that needs to sign for this transaction
    const multisigKp = Keypair.generate();
    const lamports = await connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE);

    return {
        instructions: [
            SystemProgram.createAccount({
                fromPubkey: payerPk,
                newAccountPubkey: multisigKp.publicKey,
                space: MULTISIG_SIZE,
                lamports,
                programId,
            }),
            createInitializeMultisigInstruction(multisigKp.publicKey, signers, m, programId),
        ],
        multisigKp,
    };
}
