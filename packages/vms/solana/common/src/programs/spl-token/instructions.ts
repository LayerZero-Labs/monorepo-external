import {
    AuthorityType,
    createSetAuthorityInstruction,
    createTransferInstruction,
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createInitializeMintInstruction, getMintLen } from '@solana/spl-token';
import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Keypair, SystemProgram } from '@solana/web3.js';

/**
 * Creates a standard SPL token without metadata using the SPL Token program.
 *
 * This is an alternative to the MPL Token Metadata approach when you don't need
 * rich metadata and want to avoid dependency on the Metaplex program.
 *
 * @param args - Token creation arguments
 * @param args.name - Token name (for reference only, not stored on-chain)
 * @param args.symbol - Token symbol (for reference only, not stored on-chain)
 * @param args.decimals - Number of decimal places for the token
 * @param args.mintAuthority - Public key of the mint authority
 * @param args.freezeAuthority - Public key of the freeze authority (optional)
 * @param args.payer - Account that pays for transaction fees
 *
 * @returns Object containing:
 * - `transactionInstructions`: Array of transaction instructions
 * - `mintKp`: The generated mint keypair
 *
 * @example
 * ```typescript
 * const { transactionInstructions, mintKp } = await createStandardSPLToken({
 *   name: 'My Token',
 *   symbol: 'MTK',
 *   decimals: 6,
 *   mintAuthority: mintAuthorityPubkey,
 *   freezeAuthority: freezeAuthorityPubkey,
 *   payer: payerPubkey,
 * });
 * ```
 */
export async function createStandardSPLToken(args: {
    name: string;
    symbol: string;
    decimals: number;
    mintAuthority: PublicKey;
    freezeAuthority?: PublicKey;
    payer: PublicKey;
    connection: Connection;
}): Promise<{
    transactionInstructions: TransactionInstruction[];
    mintKp: Keypair;
}> {
    const mintKp = Keypair.generate();
    const mintLen = getMintLen([]);
    const lamports = await args.connection.getMinimumBalanceForRentExemption(mintLen);

    const instructions: TransactionInstruction[] = [
        // Create the mint account
        SystemProgram.createAccount({
            fromPubkey: args.payer,
            newAccountPubkey: mintKp.publicKey,
            space: mintLen,
            lamports,
            programId: TOKEN_PROGRAM_ID,
        }),
        // Initialize the mint
        createInitializeMintInstruction(
            mintKp.publicKey,
            args.decimals,
            args.mintAuthority,
            args.freezeAuthority || null,
            TOKEN_PROGRAM_ID,
        ),
    ];

    return {
        transactionInstructions: instructions,
        mintKp,
    };
}

export function setAuthorityIxs(
    args: {
        account: PublicKey;
        currentAuthority: PublicKey;
        newAuthority: PublicKey;
    },
    authorityTypes: AuthorityType[] = [AuthorityType.MintTokens, AuthorityType.FreezeAccount],
): TransactionInstruction[] {
    return authorityTypes.map((authorityType) =>
        createSetAuthorityInstruction(
            args.account,
            args.currentAuthority,
            authorityType,
            args.newAuthority,
        ),
    );
}

/**
 * Gets the associated token account address for a given mint and owner.
 *
 * @param tokenAddress - The token address
 * @param ownerAddress - The owner's wallet address
 * @returns The associated token account address
 */
export function getSPLTokenAssociatedAddress({
    tokenAddress,
    ownerAddress,
}: {
    tokenAddress: PublicKey;
    ownerAddress: PublicKey;
}): PublicKey {
    return getAssociatedTokenAddressSync(tokenAddress, ownerAddress, false, TOKEN_PROGRAM_ID);
}

/**
 * Creates a transfer instruction for SPL tokens.
 *
 * @param args - Transfer instruction arguments
 * @param args.tokenAddress - The token address
 * @param args.sourceOwner - The owner of the source token account
 * @param args.destinationOwner - The owner of the destination token account
 * @param args.amount - The amount of tokens to transfer (in smallest unit)
 * @returns Transaction instruction for the transfer
 */
export function createSPLTokenTransferInstruction({
    tokenAddress,
    sourceOwner,
    destinationOwner,
    amount,
}: {
    tokenAddress: PublicKey;
    sourceOwner: PublicKey;
    destinationOwner: PublicKey;
    amount: bigint;
}): TransactionInstruction {
    const sourceTokenAccount = getSPLTokenAssociatedAddress({
        tokenAddress,
        ownerAddress: sourceOwner,
    });
    const destinationTokenAccount = getSPLTokenAssociatedAddress({
        tokenAddress,
        ownerAddress: destinationOwner,
    });

    return createTransferInstruction(
        sourceTokenAccount,
        destinationTokenAccount,
        sourceOwner,
        amount,
        [],
        TOKEN_PROGRAM_ID,
    );
}
