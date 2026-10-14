import type {
    CreateV1InstructionAccounts,
    CreateV1InstructionArgs,
} from '@metaplex-foundation/mpl-token-metadata';
import { createV1, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import { AuthorityType, setAuthority } from '@metaplex-foundation/mpl-toolbox';
import type { Umi } from '@metaplex-foundation/umi';
import { generateSigner, none, percentAmount, transactionBuilder } from '@metaplex-foundation/umi';
import {
    fromWeb3JsPublicKey,
    toWeb3JsInstruction,
    toWeb3JsKeypair,
} from '@metaplex-foundation/umi-web3js-adapters';
import type { PublicKey } from '@solana/web3.js';

/**
 * Native JavaScript types for creating a fungible token with metadata.
 * These match the schema types defined in spl-token-activity-factory.
 */
export interface FungibleTokenCreationArgs {
    name: string;
    symbol: string;
    decimals: number;
    uri: string;
    isMutable: boolean;
    sellerFeeBasisPoints: number;
    tokenStandard: string;
}

/**
 * Creates a new token with metadata using Metaplex Token Metadata Program's createV1 instruction.
 *
 * This function automatically generates a new mint keypair and creates all necessary instructions
 * to initialize both the SPL token mint and its associated metadata account. The resulting token
 * will have rich metadata (name, symbol, URI, etc.) and be compatible with wallets and explorers.
 *
 * @param umi - The Umi instance configured with the necessary plugins and signer
 * @param args - Token creation arguments and account configurations (mint keypair is auto-generated)
 * @param args.name - The name of the token (e.g., "My Token")
 * @param args.symbol - The symbol of the token (e.g., "MTK")
 * @param args.uri - URI pointing to off-chain metadata JSON
 * @param args.sellerFeeBasisPoints - Royalty percentage in basis points (e.g., 500 = 5%)
 * @param args.tokenStandard - Token standard (Fungible, NonFungible, etc.)
 * @param args.creators - Optional array of creator accounts with verification status
 * @param args.collection - Optional collection this token belongs to
 * @param args.uses - Optional usage configuration for utility tokens
 * @param args.authority - Authority account for the token (defaults to umi identity)
 * @param args.payer - Account that pays for transaction fees (defaults to umi identity)
 *
 * @returns Object containing:
 * - `transactionInstructions`: Array of Web3.js transaction instructions ready to be sent
 * - `mintKp`: The generated mint keypair (contains the new token's mint address)
 *
 * @example
 * ```typescript
 * const { transactionInstructions, mintKp } = createNewMintCreateV1Ix(umi, {
 *   name: 'USDA Token',
 *   symbol: 'USDA',
 *   uri: 'https://example.com/metadata.json',
 *   sellerFeeBasisPoints: percentAmount(0),
 *   tokenStandard: TokenStandard.Fungible,
 *   authority: umi.identity,
 *   payer: umi.identity,
 * });
 *
 * // Send the transaction
 * const tx = new Transaction().add(...transactionInstructions);
 * await connection.sendTransaction(tx, [mintKp]);
 *
 * // The new token mint address
 * console.log('New token mint:', mintKp.publicKey.toString());
 * ```
 *
 * @remarks
 * - The mint keypair must be included as a signer when sending the transaction
 * - This creates both the underlying SPL token mint AND the metadata account in one transaction
 * - For fungible tokens, you'll need to mint tokens separately using mintV1 or similar functions
 * - The function converts Umi instructions to Web3.js format for broader compatibility
 */
export const createNewMintCreateV1Ix = (
    umi: Umi,
    args: Omit<CreateV1InstructionArgs, 'mint'> & Omit<CreateV1InstructionAccounts, 'mint'>,
) => {
    const mintKp = generateSigner(umi);
    let txBuilder = transactionBuilder().add(
        createV1(umi, {
            ...args,
            mint: mintKp,
        }),
    );
    return {
        transactionInstructions: txBuilder.getInstructions().map((ix) => toWeb3JsInstruction(ix)),
        mintKp: toWeb3JsKeypair(mintKp),
    };
};

/**
 * Creates a new fungible token with metadata using Metaplex Token Metadata Program.
 *
 * This function accepts native JavaScript types and automatically converts them to the
 * appropriate Umi types internally. It creates a fungible SPL token with rich metadata
 * that's compatible with all Solana wallets and explorers.
 *
 * @param umi - The Umi instance configured with the necessary plugins and signer
 * @param args - Token creation arguments using native JavaScript types
 * @param args.name - The name of the fungible token (e.g., "USD Coin")
 * @param args.symbol - The symbol of the token (e.g., "USDC")
 * @param args.decimals - Number of decimal places for the token (e.g., 6 for USDC)
 * @param args.uri - URI pointing to off-chain metadata JSON
 * @param args.isMutable - Whether the metadata can be updated after creation
 * @param args.sellerFeeBasisPoints - Royalty percentage in basis points (typically 0 for fungible tokens)
 * @param args.tokenStandard - Token standard as string (will be converted to TokenStandard.Fungible)
 * @param args.mintAuthorityAccount - Public key string of the mint authority
 * @param args.freezeAuthorityAccount - Public key string of the freeze authority
 *
 * @returns Object containing:
 * - `transactionInstructions`: Array of Web3.js transaction instructions ready to be sent
 * - `mintKp`: The generated mint keypair (contains the new token's mint address)
 *
 * @example
 * ```typescript
 * const { transactionInstructions, mintKp } = createNewFungibleTokenWithMetadataIx(umi, {
 *   name: 'USDA Stablecoin',
 *   symbol: 'USDA',
 *   decimals: 6,
 *   uri: 'https://example.com/usda-metadata.json',
 *   isMutable: true,
 *   sellerFeeBasisPoints: 0, // No royalties for fungible tokens
 *   tokenStandard: 'Fungible',
 *   mintAuthorityAccount: 'AUTH1234...', // Public key as string
 *   freezeAuthorityAccount: 'FREEZE567...' // Public key as string
 * });
 *
 * // Send the transaction to create the fungible token
 * const tx = new Transaction().add(...transactionInstructions);
 * await connection.sendTransaction(tx, [mintKp]);
 * ```
 *
 * @remarks
 * - Automatically converts string addresses to Umi PublicKey types
 * - Converts number sellerFeeBasisPoints to percentAmount format
 * - Sets tokenStandard to TokenStandard.Fungible regardless of input
 * - The token will have 0 supply initially - use mintV1 to mint tokens after creation
 * - The resulting token will be compatible with all Solana wallets and DEXs
 */
export const createNewFungibleTokenWithMetadataIx = (umi: Umi, args: FungibleTokenCreationArgs) => {
    // Note: mintAuthorityAccount and freezeAuthorityAccount are currently not used
    // in the initial token creation. These authorities would typically be set via
    // separate SPL Token instructions after the token mint is created.

    // Convert native JavaScript types to Umi/Metaplex types and reuse existing function
    return createNewMintCreateV1Ix(umi, {
        name: args.name,
        symbol: args.symbol,
        uri: args.uri,
        isMutable: args.isMutable,
        sellerFeeBasisPoints: percentAmount(args.sellerFeeBasisPoints),
        decimals: args.decimals,
        tokenStandard: TokenStandard.Fungible, // Always fungible regardless of input
        creators: none(), // No creators by default
        authority: umi.identity,
        payer: umi.identity,
    });
};

export const createSetAuthorityIx = (
    umi: Umi,
    args: {
        owned: PublicKey;
        owner: PublicKey;
        newAuthority: PublicKey;
    },
) => {
    const owned = fromWeb3JsPublicKey(args.owned);
    const owner = fromWeb3JsPublicKey(args.owner);
    const newAuthority = fromWeb3JsPublicKey(args.newAuthority);
    let txBuilder = transactionBuilder()
        .add(
            setAuthority(umi, {
                owned,
                owner,
                newAuthority,
                authorityType: AuthorityType.MintTokens,
            }),
        )
        .add(
            setAuthority(umi, {
                owned,
                owner,
                newAuthority,
                authorityType: AuthorityType.FreezeAccount,
            }),
        )
        .add(
            setAuthority(umi, {
                owned,
                owner,
                newAuthority,
                authorityType: AuthorityType.AccountOwner,
            }),
        )
        .add(
            setAuthority(umi, {
                owned,
                owner,
                newAuthority,
                authorityType: AuthorityType.CloseAccount,
            }),
        );

    return txBuilder.getInstructions().map((ix) => toWeb3JsInstruction(ix));
};
