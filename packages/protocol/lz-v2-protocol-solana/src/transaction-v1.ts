import type { Instruction, PublicKey } from '@metaplex-foundation/umi';
import {
    AccountRole,
    address,
    appendTransactionMessageInstructions,
    assertIsTransactionWithinSizeLimit,
    compileTransaction,
    createTransactionMessage,
    type Instruction as KitInstruction,
    pipe,
    setTransactionMessageConfig,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    type TransactionBlockhashLifetime,
    type V1TransactionConfig,
} from '@solana/kit';

/** The resource budgets every Transaction V1 states; only the priority fee is optional. */
export type TransactionV1Budgets = Required<
    Pick<V1TransactionConfig, 'computeUnitLimit' | 'loadedAccountsDataSizeLimit' | 'heapSize'>
> &
    Pick<V1TransactionConfig, 'priorityFeeLamports'>;

/** Preserve instruction order, duplicate account occurrences and privileges at the Umi/Kit boundary. */
export function toKitInstruction(instruction: Instruction): KitInstruction {
    return {
        programAddress: address(instruction.programId),
        accounts: instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
            address: address(pubkey),
            role: isSigner
                ? isWritable
                    ? AccountRole.WRITABLE_SIGNER
                    : AccountRole.READONLY_SIGNER
                : isWritable
                  ? AccountRole.WRITABLE
                  : AccountRole.READONLY,
        })),
        data: instruction.data,
    };
}

/**
 * Compile an unsigned Solana Transaction V1 using Kit's canonical wire format.
 * Sign the returned Kit transaction before submission; planner simulations use sigVerify=false.
 * Resource budgets belong in V1 config, not ComputeBudget instructions, and every caller states
 * them: there are no defaults. Priority fees are TOTAL lamports, not micro-lamports per CU.
 */
export function compileTransactionV1(
    payer: PublicKey,
    instructions: readonly Instruction[],
    lifetime: TransactionBlockhashLifetime,
    budgets: TransactionV1Budgets,
) {
    if (budgets.computeUnitLimit <= 0 || budgets.loadedAccountsDataSizeLimit <= 0) {
        throw new Error('Transaction V1 requires positive compute and loaded-account data budgets');
    }
    if (instructions.some((ix) => ix.programId === 'ComputeBudget111111111111111111111111111111')) {
        throw new Error('Use Transaction V1 config instead of ComputeBudget instructions');
    }
    const message = pipe(
        createTransactionMessage({ version: 1 }),
        (tx) => setTransactionMessageFeePayer(address(payer), tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(lifetime, tx),
        (tx) => setTransactionMessageConfig(budgets, tx),
        (tx) => appendTransactionMessageInstructions(instructions.map(toKitInstruction), tx),
    );
    // Kit validates V1 account/signature/instruction limits during compilation. Size includes
    // every signature slot, even though the signatures have not been supplied yet.
    const transaction = compileTransaction(message);
    assertIsTransactionWithinSizeLimit(transaction);
    return transaction;
}
