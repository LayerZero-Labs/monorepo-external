import type { Instruction, PublicKey } from '@metaplex-foundation/umi';
import { toWeb3JsInstruction, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import type { Connection } from '@solana/web3.js';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';

import { parallelProcess } from '@layerzerolabs/common-concurrency-utils';

const DEFAULT_MAX_CONCURRENT_SIMULATIONS = 5;

export interface SimulateLamportAllowancesArgs {
    connection: Connection;
    oneSigSigner: PublicKey;
    instructions: Instruction[];
    dummyFeePayer: PublicKey;
    maxConcurrentSimulations?: number;
}

/**
 * Simulates each instruction independently with the OneSig signer PDA flagged
 * as signer, then reports the lamports deducted from that PDA.
 */
export async function simulateLamportAllowances(
    args: SimulateLamportAllowancesArgs,
): Promise<bigint[]> {
    const { connection, instructions, oneSigSigner } = args;
    if (instructions.length === 0) {
        return [];
    }

    const maxConcurrentSimulations =
        args.maxConcurrentSimulations ?? DEFAULT_MAX_CONCURRENT_SIMULATIONS;
    if (maxConcurrentSimulations < 1) {
        throw new Error('maxConcurrentSimulations must be greater than 0');
    }

    const oneSigSignerPda = toWeb3JsPublicKey(oneSigSigner);
    const payerKey = toWeb3JsPublicKey(args.dummyFeePayer);
    // Each instruction is simulated independently against current chain state,
    // so they all compare against the same pre-simulation PDA balance.
    const balanceBefore = BigInt((await connection.getAccountInfo(oneSigSignerPda))?.lamports ?? 0);
    const { blockhash } = await connection.getLatestBlockhash();

    return parallelProcess(
        instructions.map((instruction) => async () => {
            const message = new TransactionMessage({
                payerKey,
                recentBlockhash: blockhash,
                instructions: [
                    toWeb3JsInstruction({
                        ...instruction,
                        keys: instruction.keys.map((key) => ({
                            ...key,
                            // The outer transaction cannot be signed by an off-curve PDA.
                            // Mark it as signer only inside simulation to mirror invoke_signed.
                            isSigner: key.pubkey.toString() === oneSigSigner.toString(),
                        })),
                    }),
                ],
            }).compileToV0Message();
            const tx = new VersionedTransaction(message);

            const sim = await connection.simulateTransaction(tx, {
                sigVerify: false,
                replaceRecentBlockhash: true,
                commitment: 'confirmed',
                accounts: {
                    encoding: 'base64',
                    addresses: [oneSigSignerPda.toBase58()],
                },
            });

            if (sim.value.err) {
                const logs = sim.value.logs?.join('\n') ?? '';
                throw new Error(
                    `simulateLamportAllowances failed: ${JSON.stringify(sim.value.err)}\nlogs:\n${logs}`,
                );
            }

            const accounts = sim.value.accounts;
            if (!accounts || accounts.length === 0) {
                return 0n;
            }

            const balanceAfter = accounts[0] ? BigInt(accounts[0].lamports) : 0n;
            return balanceBefore > balanceAfter ? balanceBefore - balanceAfter : 0n;
        }),
        maxConcurrentSimulations,
    );
}
