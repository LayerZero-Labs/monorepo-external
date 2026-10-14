import { getMint } from '@solana/spl-token';
import type { Connection, PublicKey } from '@solana/web3.js';

import { getSPLTokenAssociatedAddress } from './instructions';

export async function fetchMintAuthorities(connection: Connection, mintAddress: PublicKey) {
    const mintInfo = await getMint(connection, mintAddress);

    return {
        mintAuthority: mintInfo.mintAuthority?.toBase58(),
        freezeAuthority: mintInfo.freezeAuthority?.toBase58(),
    };
}

/**
 * Gets the SPL token balance for a wallet.
 *
 * @param connection - Solana connection
 * @param tokenAddress - The token address
 * @param ownerAddress - The owner's wallet address
 * @returns The token balance as a bigint, or 0n if the account doesn't exist
 */
export async function getSPLTokenBalance({
    connection,
    tokenAddress,
    ownerAddress,
}: {
    connection: Connection;
    tokenAddress: PublicKey;
    ownerAddress: PublicKey;
}): Promise<bigint> {
    try {
        const associatedTokenAddress = getSPLTokenAssociatedAddress({ tokenAddress, ownerAddress });
        const tokenAccount = await connection.getTokenAccountBalance(associatedTokenAddress);

        if (!tokenAccount?.value) {
            return 0n;
        }

        return BigInt(tokenAccount.value.amount);
    } catch (error: any) {
        if (
            error?.message?.includes(
                'failed to get token account balance: Invalid param: could not find account',
            )
        ) {
            return 0n;
        }
        throw error;
    }
}
